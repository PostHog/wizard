import axios, { AxiosError } from 'axios';
import { z } from 'zod';
import { analytics } from '@utils/analytics';
import { WIZARD_USER_AGENT } from './constants';
import { sleep } from './helper-functions';

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
): Promise<ApiUser> {
  try {
    const response = await axios.get(`${baseUrl}/api/users/@me/`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': WIZARD_USER_AGENT,
      },
    });

    return ApiUserSchema.parse(response.data);
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
): Promise<ApiProject> {
  try {
    const response = await axios.get(`${baseUrl}/api/projects/${projectId}/`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': WIZARD_USER_AGENT,
      },
    });

    return ApiProjectSchema.parse(response.data);
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

// The Slack check runs on a non-critical post-install step and against a
// flaky-under-load gateway, so transient failures are expected. Ride them
// out with a short timeout plus a couple of quick retries rather than
// surfacing every network blip.
const SLACK_CHECK_TIMEOUT_MS = 5000;
// One quick retry, then a slightly longer one — enough to clear a single
// gateway hiccup or socket reset without visibly stalling the 3s poll
// (worst case ~1.3s of added backoff on top of request time).
const SLACK_CHECK_BACKOFFS_MS = [300, 1000];

// Gateway-class statuses worth retrying. A 401/403/404 (or anything else)
// is a genuine error the caller should report, not a transient blip.
const TRANSIENT_STATUSES = new Set([502, 503, 504]);

// Socket/transport error codes that routinely recover on a retry. Includes
// the axios client-side timeout (ECONNABORTED) and the DNS-level EAI_AGAIN.
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EADDRNOTAVAIL',
  'ENETUNREACH',
  'ENETDOWN',
  'EPIPE',
  'EAI_AGAIN',
]);

// Some transport failures arrive as a bare Error with a missing or
// unhelpful `code` — most notably the TLS-handshake disconnect ("Client
// network socket disconnected before secure TLS connection was
// established"). Fall back to matching those by message.
const TRANSIENT_MESSAGE_RE =
  /socket disconnected|before secure tls|network socket|EADDRNOTAVAIL|ECONNRESET|ETIMEDOUT/i;

/**
 * Classify an error from the Slack check as a transient network failure
 * (retry / degrade quietly) vs. a genuine error (report). Only axios
 * errors are considered; anything else is treated as genuine.
 */
function isTransientSlackCheckError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  // Got an HTTP response → only gateway-class 5xx are transient.
  if (status !== undefined) return TRANSIENT_STATUSES.has(status);
  // No response → transport/network-layer failure.
  if (error.code && TRANSIENT_NETWORK_CODES.has(error.code)) return true;
  const cause =
    (error.cause as { message?: string } | undefined)?.message ?? '';
  return TRANSIENT_MESSAGE_RE.test(`${error.message} ${cause}`);
}

/**
 * Check whether the project already has a Slack integration connected.
 * Requires the `integration:read` scope.
 *
 * Resilient to transient failures: a short timeout plus a small
 * retry/backoff for gateway 5xx and retryable socket/TLS errors. When the
 * transient budget is exhausted, degrades to "not connected" (returns
 * `false`) WITHOUT throwing — this runs on a non-critical post-install
 * step where the caller already falls back to the connect nudge, so a
 * flaky network shouldn't generate error-tracking noise.
 *
 * Throws only on genuine, non-transient errors (401/403, malformed
 * response, etc.). The caller (the SlackConnectScreen poll) is responsible
 * for capturing those exactly once. A caller-initiated abort propagates as
 * a cancellation for the caller's teardown guard to swallow.
 */
export async function fetchSlackConnected(
  accessToken: string,
  projectId: number,
  baseUrl: string,
  signal?: AbortSignal,
): Promise<boolean> {
  for (let attempt = 0; attempt <= SLACK_CHECK_BACKOFFS_MS.length; attempt++) {
    if (attempt > 0) await sleep(SLACK_CHECK_BACKOFFS_MS[attempt - 1]);
    // Don't spend another attempt if the caller tore the screen down.
    if (signal?.aborted) throw new ApiError('Slack connection check aborted');
    try {
      const response = await axios.get(
        `${baseUrl}/api/projects/${projectId}/integrations/`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'User-Agent': WIZARD_USER_AGENT,
          },
          signal,
          timeout: SLACK_CHECK_TIMEOUT_MS,
        },
      );
      const parsed = IntegrationsResponseSchema.safeParse(response.data);
      if (!parsed.success) {
        // A 200 with an unexpected shape means the API contract changed
        // under us — a genuine bug, not a network blip. Report it.
        throw new ApiError(
          'Invalid response format while checking Slack connection',
        );
      }
      return parsed.data.results.some((i) => i.kind === 'slack');
    } catch (error) {
      // Caller-initiated abort (screen teardown): propagate without
      // retrying. The poll's `cancelled` guard swallows it so it never
      // reaches captureException.
      if (axios.isCancel(error) || signal?.aborted) throw error;

      const transient = isTransientSlackCheckError(error);
      // Retry transient failures until the backoff budget is spent.
      if (transient && attempt < SLACK_CHECK_BACKOFFS_MS.length) continue;
      // Exhausted transient → degrade quietly to "not connected".
      if (transient) return false;
      // Genuine, non-transient error → let the caller report it.
      throw error instanceof ApiError
        ? error
        : handleApiError(error, 'check Slack connection');
    }
  }
  // Unreachable: the loop always returns or throws on the final attempt.
  return false;
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
