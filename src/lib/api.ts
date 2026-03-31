import axios, { AxiosError } from 'axios';
import { z } from 'zod';
import { analytics } from '../utils/analytics';
import { WIZARD_USER_AGENT } from './constants';

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

export const ApiPromptSchema = z.object({
  id: z.string(),
  name: z.string(),
  prompt: z.unknown(),
  version: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ApiUser = z.infer<typeof ApiUserSchema>;
export type ApiProject = z.infer<typeof ApiProjectSchema>;
export type ApiPrompt = z.infer<typeof ApiPromptSchema>;

class ApiError extends Error {
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

export async function fetchPrompts(
  accessToken: string,
  teamId: number,
  baseUrl: string,
): Promise<ApiPrompt[]> {
  const prompts: ApiPrompt[] = [];
  let url:
    | string
    | null = `${baseUrl}/api/environments/${teamId}/llm_prompts/?limit=200`;

  const pageSchema = z.object({
    results: z.array(ApiPromptSchema),
    next: z.string().nullable().optional(),
  });

  try {
    while (url) {
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': WIZARD_USER_AGENT,
        },
      });

      const parsed = pageSchema.parse(response.data);

      prompts.push(...parsed.results);
      url = parsed.next ?? null;
    }

    return prompts;
  } catch (error) {
    const apiError = handleApiError(error, 'fetch prompts');
    analytics.captureException(apiError, {
      endpoint: `/api/environments/${teamId}/llm_prompts/`,
      baseUrl,
      teamId,
    });
    throw apiError;
  }
}

function handleApiError(error: unknown, operation: string): ApiError {
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
