import axios, { AxiosError } from 'axios';
import { z } from 'zod';
import { analytics } from '@utils/analytics';
import { sleep } from './helper-functions';
import { WIZARD_USER_AGENT } from './constants';

// Retry policy for transient backend/network failures. A momentary 5xx,
// network drop, or timeout on a read shouldn't abort the whole run before
// PostHog setup can begin, so we retry with exponential backoff. Definite
// failures (401/403/404, invalid payloads) are left to fail fast.
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 4000;

export const ApiUserSchema = z.object({
  distinct_id: z.string(),
  organizations: z.array(
    z.object({
      id: z.string().uuid(),
    }),
  ),
  team: z.object({
    id: z.number(),
    organization: z.string().uuid(),
  }),
  organization: z.object({
    id: z.string().uuid(),
  }),
});

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

/**
 * A failure is transient if retrying might succeed: a network drop/timeout
 * (no HTTP response) or a 5xx server error. Definite failures — auth
 * (401/403), missing resources (404), and other 4xx — are not retried, nor
 * are malformed responses (ZodError), which won't change on retry.
 */
function isTransientError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }
  const status = error.response?.status;
  if (status === undefined) {
    // No response: network error, timeout, or connection reset.
    return true;
  }
  return status >= 500;
}

/**
 * Run an async operation, retrying transient failures with exponential
 * backoff. Definite failures throw immediately on the first attempt.
 */
async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let backoff = BASE_BACKOFF_MS;

  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !isTransientError(error)) {
        throw error;
      }
      await sleep(backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }
}

export async function fetchUserData(
  accessToken: string,
  baseUrl: string,
): Promise<ApiUser> {
  try {
    const response = await withRetry(() =>
      axios.get(`${baseUrl}/api/users/@me/`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': WIZARD_USER_AGENT,
        },
      }),
    );

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

export async function fetchProjectData(
  accessToken: string,
  projectId: number,
  baseUrl: string,
): Promise<ApiProject> {
  try {
    const response = await withRetry(() =>
      axios.get(`${baseUrl}/api/projects/${projectId}/`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': WIZARD_USER_AGENT,
        },
      }),
    );

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
