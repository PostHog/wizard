import axios, { AxiosError } from 'axios';
import { z } from 'zod';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import { WIZARD_USER_AGENT } from './constants';

/**
 * Per-request timeout for the auth/bootstrap GETs below. Without it a hung
 * connection to `/api/users/@me/` would block a CI pre-run forever instead
 * of failing fast into the transient-retry path.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Backoff schedule for transient failures. Length = number of retries after
 * the first attempt (so 4 attempts total). Sized to ride out a short upstream
 * blip — a brief `/api/users/@me/` 5xx or network hiccup — without stalling
 * the run for long. Worst case ~6.5s of waiting before we give up.
 */
const RETRY_BACKOFFS_MS = [500, 2000, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A transient failure is one worth riding out with a retry: a 5xx from
 * PostHog's API, or a network-level error (no HTTP response at all — DNS
 * failure, connection reset, or a client-side timeout). Everything with a
 * 4xx status is the caller's problem (auth, scope, not-found) and is never
 * retried, and non-axios errors (e.g. a Zod parse failure) aren't either.
 */
export function isTransientApiError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  if (status != null) return status >= 500;
  // No response object → the request never completed: network error, DNS
  // failure, connection reset, or a timeout (ECONNABORTED). All transient.
  return true;
}

export interface ApiRetryOptions {
  /** Backoff schedule; overrides the default. Length = number of retries. */
  backoffsMs?: number[];
  /** Injectable sleep so tests don't wait on real timers. */
  sleepImpl?: (ms: number) => Promise<void>;
}

/**
 * Run an idempotent API GET, retrying transient (5xx / network / timeout)
 * failures with exponential-ish backoff. Non-transient failures throw
 * immediately; the caller maps the raw error via `handleApiError`.
 */
async function withApiRetry<T>(
  operation: string,
  fn: () => Promise<T>,
  opts: ApiRetryOptions = {},
): Promise<T> {
  const backoffsMs = opts.backoffsMs ?? RETRY_BACKOFFS_MS;
  const sleepImpl = opts.sleepImpl ?? sleep;
  let lastError: unknown;

  for (let attempt = 0; attempt <= backoffsMs.length; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= backoffsMs.length || !isTransientApiError(error)) {
        throw error;
      }
      const wait = backoffsMs[attempt];
      logToFile(
        `[api] transient failure while trying to ${operation} (attempt ${
          attempt + 1
        }/${backoffsMs.length + 1}); retrying in ${wait}ms`,
      );
      await sleepImpl(wait);
    }
  }

  // Unreachable — the loop either returns or throws — but keeps TS happy.
  throw lastError;
}

/**
 * User payload from `/api/users/@me/`. Schema typed for the fields the
 * wizard actually reads + passthrough on everything else so the full
 * upstream response rides through to the session for downstream features
 * (account-aware copy, plan-gated flows, org/team metadata, etc.).
 *
 * Top-level uses `.passthrough()` so unknown fields aren't stripped;
 * the few nested objects we care about (team, organization,
 * organizations[]) do the same so their additional fields survive too.
 *
 * Keep `distinct_id` required — analytics depends on it. Everything
 * else added here is nullish so partial responses don't fail parsing.
 */
export const ApiUserSchema = z
  .object({
    // Identifiers
    distinct_id: z.string(),
    uuid: z.string().nullish(),
    id: z.number().nullish(),

    // Profile
    email: z.string().nullish(),
    first_name: z.string().nullish(),
    last_name: z.string().nullish(),
    date_joined: z.string().nullish(),
    is_email_verified: z.boolean().nullish(),
    is_2fa_enabled: z.boolean().nullish(),
    is_staff: z.boolean().nullish(),

    // Preferences
    theme_mode: z.string().nullish(),
    toolbar_mode: z.string().nullish(),
    hide_mcp_hints: z.boolean().nullish(),

    // Optional / nullable on the backend — pre-onboarding signup paths
    // return null and older accounts may not have it set. Treat as a
    // hint, never a guarantee.
    role_at_organization: z.string().nullish(),

    // Current team + organization (objects from the API, kept typed on
    // the fields the wizard uses; passthrough preserves the rest).
    team: z
      .object({
        id: z.number(),
        uuid: z.string().nullish(),
        organization: z.string().uuid(),
        api_token: z.string().nullish(),
        project_id: z.number().nullish(),
        name: z.string().nullish(),
        timezone: z.string().nullish(),
      })
      .passthrough(),
    organization: z
      .object({
        id: z.string().uuid(),
        name: z.string().nullish(),
        slug: z.string().nullish(),
        membership_level: z.number().nullish(),
        customer_id: z.string().nullish(),
        // Org-level AI consent gate. Signals drops all findings while
        // this is not true. Null on older orgs (pre-2026-05 default
        // flip) — treat null as "unknown", not "off".
        is_ai_data_processing_approved: z.boolean().nullish(),
      })
      .passthrough(),
    organizations: z.array(
      z
        .object({
          id: z.string().uuid(),
          name: z.string().nullish(),
          membership_level: z.number().nullish(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

/**
 * Single activity log entry the wizard cares about. The PostHog endpoint
 * returns much more — schema kept minimal so changes upstream don't break us.
 *
 * @unused — no current caller after the Phase 6 streaming-agent pivot
 * dropped activity_log polling. Deliberately retained: this is a thin,
 * well-typed wrapper around a stable PostHog endpoint, and we're likely
 * to want it again for a future feature (e.g. "what changed in your
 * project recently"). Re-deriving the schema is more work than letting
 * it sit dormant.
 */
export const ActivityLogEntrySchema = z
  .object({
    scope: z.string().nullish(),
    activity: z.string().nullish(),
    created_at: z.string().nullish(),
  })
  .passthrough();

/** @unused — see ActivityLogEntrySchema. */
export const ActivityLogResponseSchema = z.object({
  results: z.array(ActivityLogEntrySchema),
});

/** @unused — see ActivityLogEntrySchema. */
export type ActivityLogEntry = z.infer<typeof ActivityLogEntrySchema>;

export const ApiProjectSchema = z.object({
  id: z.number(),
  uuid: z.string().uuid(),
  organization: z.string().uuid(),
  api_token: z.string(),
  name: z.string(),
  // Product opt-ins (TeamSerializer-compat fields on /api/projects/:id).
  // Project-level truth for "is this product enabled" — a product can be
  // instrumented from another repo or the snippet, so these settings
  // override repo-local evidence. Null/absent = unknown. Only the
  // opt-ins a signals decision consumes: replay + exception autocapture
  // feed signal-source choices; surveys feeds the surveys-scout tuning.
  session_recording_opt_in: z.boolean().nullish(),
  autocapture_exceptions_opt_in: z.boolean().nullish(),
  surveys_opt_in: z.boolean().nullish(),
});

export type ApiUser = z.infer<typeof ApiUserSchema>;
export type ApiProject = z.infer<typeof ApiProjectSchema>;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly endpoint?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function fetchUserData(
  accessToken: string,
  baseUrl: string,
  retry: ApiRetryOptions = {},
): Promise<ApiUser> {
  try {
    return await withApiRetry(
      'fetch user data',
      async () => {
        const response = await axios.get(`${baseUrl}/api/users/@me/`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'User-Agent': WIZARD_USER_AGENT,
          },
          timeout: REQUEST_TIMEOUT_MS,
        });

        return ApiUserSchema.parse(response.data);
      },
      retry,
    );
  } catch (error) {
    const apiError = handleApiError(error, 'fetch user data');
    analytics.captureException(apiError, {
      endpoint: '/api/users/@me/',
      baseUrl,
    });
    throw apiError;
  }
}

/**
 * Best-effort fetch of recent activity log entries. Returns [] on any error
 * so callers can treat absence of results as "haven't detected anything yet"
 * rather than a hard failure.
 *
 * @unused — no current caller after the Phase 6 streaming-agent pivot
 * dropped activity_log polling from McpSuggestedPromptsScreen.
 * Deliberately retained for future features that want a soft signal of
 * recent project changes (e.g. dashboards, audit summaries). See the
 * ActivityLogEntrySchema doc comment for the keep-vs-delete rationale.
 */
export async function fetchRecentActivity(
  accessToken: string,
  projectId: number,
  baseUrl: string,
  since: Date,
): Promise<ActivityLogEntry[]> {
  try {
    const response = await axios.get(
      `${baseUrl}/api/projects/${projectId}/activity_log/`,
      {
        params: { limit: 10 },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': WIZARD_USER_AGENT,
        },
        // Short timeout — best-effort probe, not a critical path.
        timeout: 4000,
      },
    );
    const parsed = ActivityLogResponseSchema.safeParse(response.data);
    if (!parsed.success) return [];
    const sinceMs = since.getTime();
    return parsed.data.results.filter((entry) => {
      if (!entry.created_at) return false;
      const t = Date.parse(entry.created_at);
      return Number.isFinite(t) && t >= sinceMs;
    });
  } catch {
    return [];
  }
}

export async function fetchProjectData(
  accessToken: string,
  projectId: number,
  baseUrl: string,
  retry: ApiRetryOptions = {},
): Promise<ApiProject> {
  try {
    return await withApiRetry(
      'fetch project data',
      async () => {
        const response = await axios.get(
          `${baseUrl}/api/projects/${projectId}/`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'User-Agent': WIZARD_USER_AGENT,
            },
            timeout: REQUEST_TIMEOUT_MS,
          },
        );

        return ApiProjectSchema.parse(response.data);
      },
      retry,
    );
  } catch (error) {
    const apiError = handleApiError(error, 'fetch project data');
    analytics.captureException(apiError, {
      endpoint: `/api/projects/${projectId}/`,
      baseUrl,
      projectId,
    });
    throw apiError;
  }
}

/** Minimal shape of `/api/projects/:id/integrations/` — we only read `kind`. */
const IntegrationsResponseSchema = z.object({
  results: z.array(z.object({ kind: z.string().nullish() }).passthrough()),
});

/**
 * Check whether the project already has a Slack integration connected.
 * Requires the `integration:read` scope. Throws on failure — callers
 * (including the SlackConnectScreen poll) decide how to degrade and
 * are responsible for capturing the error exactly once.
 */
export async function fetchSlackConnected(
  accessToken: string,
  projectId: number,
  baseUrl: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const response = await axios.get(
    `${baseUrl}/api/projects/${projectId}/integrations/`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': WIZARD_USER_AGENT,
      },
      signal,
    },
  );
  const parsed = IntegrationsResponseSchema.safeParse(response.data);
  if (!parsed.success) return false;
  return parsed.data.results.some((i) => i.kind === 'slack');
}

export function handleApiError(error: unknown, operation: string): ApiError {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<{ detail?: string }>;
    const status = axiosError.response?.status;
    const detail = axiosError.response?.data?.detail;
    const endpoint = axiosError.config?.url;

    if (status === 401) {
      return new ApiError(
        `Authentication failed while trying to ${operation}`,
        status,
        endpoint,
      );
    }

    if (status === 403) {
      return new ApiError(
        `Access denied while trying to ${operation}`,
        status,
        endpoint,
      );
    }

    if (status === 404) {
      return new ApiError(
        `Resource not found while trying to ${operation}`,
        status,
        endpoint,
      );
    }

    // Transient failures that survived the retries in `withApiRetry`. Give a
    // clearer, actionable terminal message than the generic fallback so the
    // user knows this is a temporary upstream blip they can retry, not a
    // misconfiguration on their end.
    if (status != null && status >= 500) {
      return new ApiError(
        `PostHog's API is temporarily unavailable (HTTP ${status}) while trying to ${operation}, and retries were exhausted. This is usually a brief blip — please wait a moment and run the wizard again.`,
        status,
        endpoint,
      );
    }

    if (status == null) {
      // No HTTP response at all: network error, DNS failure, or timeout.
      return new ApiError(
        `Could not reach PostHog's API while trying to ${operation} (network error or timeout), and retries were exhausted. Check your connection and run the wizard again in a moment.`,
        status,
        endpoint,
      );
    }

    const message = detail || `Failed to ${operation}`;
    return new ApiError(message, status, endpoint);
  }

  if (error instanceof z.ZodError) {
    return new ApiError(`Invalid response format while trying to ${operation}`);
  }

  return new ApiError(
    `Unexpected error while trying to ${operation}: ${
      error instanceof Error ? error.message : 'Unknown error'
    }`,
  );
}
