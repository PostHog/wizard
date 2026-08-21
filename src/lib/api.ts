import axios, { AxiosError } from 'axios';
import { z } from 'zod';
import { analytics } from '@utils/analytics';
import { sleep } from './helper-functions';
import { WIZARD_USER_AGENT } from './constants';

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

/**
 * Failure category for an {@link ApiError}. Lets callers decide whether to
 * retry (network / timeout / server) and gives error-tracking a stable
 * discriminant instead of one opaque "Failed to …" bucket.
 */
export type ApiErrorKind =
  | 'network' // request never got a response (DNS, refused, offline)
  | 'timeout' // request aborted by a timeout
  | 'server' // 5xx from the backend
  | 'auth' // 401
  | 'forbidden' // 403
  | 'not_found' // 404
  | 'client' // other 4xx
  | 'parse' // response body failed schema validation
  | 'unknown'; // non-axios, non-zod error

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly endpoint?: string,
    public readonly kind: ApiErrorKind = 'unknown',
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ApiError';
  }

  /**
   * Transient failures worth a retry before surfacing a hard error — a
   * network blip, a timeout, or a 5xx. Auth/permission/parse failures won't
   * get better on retry.
   */
  get isTransient(): boolean {
    return (
      this.kind === 'network' ||
      this.kind === 'timeout' ||
      this.kind === 'server'
    );
  }

  /**
   * Flat property bag for analytics / error-tracking so the status code,
   * endpoint, failure kind, and underlying cause actually land on the
   * captured `$exception` instead of collapsing into one opaque message.
   */
  toProperties(): Record<string, unknown> {
    const causeMessage =
      this.cause instanceof Error
        ? this.cause.message
        : this.cause != null
        ? String(this.cause)
        : undefined;
    return {
      endpoint: this.endpoint,
      statusCode: this.statusCode,
      error_kind: this.kind,
      cause: causeMessage,
    };
  }
}

// Auth-fetch retry budget. The `/api/users/@me/` call sits on the OAuth login
// path (setup-utils) where a hard failure blocks setup, and the failures we
// see in the field are overwhelmingly transient (network blips / 5xx). A short
// retry with backoff rides over those before we surface a hard error. Only
// transient failures (see ApiError.isTransient) are retried — 401/403/404 and
// parse errors fail fast.
const USER_FETCH_MAX_ATTEMPTS = 3;
const USER_FETCH_BACKOFF_MS = 300; // doubles each retry

export type FetchUserDataOptions = {
  maxAttempts?: number;
  backoffMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
};

export async function fetchUserData(
  accessToken: string,
  baseUrl: string,
  opts: FetchUserDataOptions = {},
): Promise<ApiUser> {
  const {
    maxAttempts = USER_FETCH_MAX_ATTEMPTS,
    backoffMs = USER_FETCH_BACKOFF_MS,
    sleepImpl = sleep,
  } = opts;

  for (let attempt = 1; ; attempt++) {
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
      if (attempt < maxAttempts && apiError.isTransient) {
        await sleepImpl(backoffMs * 2 ** (attempt - 1));
        continue;
      }

      // Capture exactly once, after retries are exhausted, with the status,
      // endpoint, failure kind, and underlying cause attached so
      // error-tracking can tell a transient blip from a real regression.
      analytics.captureException(apiError, {
        ...apiError.toProperties(),
        endpoint: '/api/users/@me/',
        baseUrl,
        attempts: attempt,
      });
      throw apiError;
    }
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
      ...apiError.toProperties(),
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
        'auth',
        { cause: axiosError },
      );
    }

    if (status === 403) {
      return new ApiError(
        `Access denied while trying to ${operation}`,
        status,
        endpoint,
        'forbidden',
        { cause: axiosError },
      );
    }

    if (status === 404) {
      return new ApiError(
        `Resource not found while trying to ${operation}`,
        status,
        endpoint,
        'not_found',
        { cause: axiosError },
      );
    }

    // No response at all — the request never reached the backend or timed
    // out. Previously this collapsed into a bare `Failed to ${operation}`
    // with a null status, so a DNS blip, an offline machine, and a dropped
    // connection were all indistinguishable in error-tracking. Surface the
    // transport-level code (ECONNABORTED, ETIMEDOUT, ENOTFOUND, …) and mark
    // the failure kind so callers can retry and the issue carries a cause.
    if (!axiosError.response) {
      const code = axiosError.code;
      const isTimeout =
        code === 'ECONNABORTED' ||
        code === 'ETIMEDOUT' ||
        axiosError.message.toLowerCase().includes('timeout');
      const reason = code ?? axiosError.message ?? 'no response';
      return new ApiError(
        `${
          isTimeout ? 'Request timed out' : 'Network error'
        } while trying to ${operation} (${reason})`,
        undefined,
        endpoint,
        isTimeout ? 'timeout' : 'network',
        { cause: axiosError },
      );
    }

    // 5xx — the backend responded but failed. Retryable, and worth carrying
    // the status so a transient blip is distinguishable from a real 5xx
    // regression. 4xx we don't special-case falls through as a client error.
    if (status !== undefined && status >= 500) {
      const message = detail
        ? `Server error (${status}) while trying to ${operation}: ${detail}`
        : `Server error (${status}) while trying to ${operation}`;
      return new ApiError(message, status, endpoint, 'server', {
        cause: axiosError,
      });
    }

    const statusPart = status !== undefined ? ` (${status})` : '';
    const message = detail
      ? `Failed to ${operation}${statusPart}: ${detail}`
      : `Failed to ${operation}${statusPart}`;
    return new ApiError(message, status, endpoint, 'client', {
      cause: axiosError,
    });
  }

  if (error instanceof z.ZodError) {
    return new ApiError(
      `Invalid response format while trying to ${operation}: ${error.issues
        .map((i) => `${i.path.join('.') || '(root)'} ${i.message}`)
        .join('; ')}`,
      undefined,
      undefined,
      'parse',
      { cause: error },
    );
  }

  return new ApiError(
    `Unexpected error while trying to ${operation}: ${
      error instanceof Error ? error.message : 'Unknown error'
    }`,
    undefined,
    undefined,
    'unknown',
    { cause: error },
  );
}
