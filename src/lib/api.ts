import axios, { AxiosError } from 'axios';
import { z } from 'zod';
import { analytics } from '@utils/analytics';
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
