import { getSkillsBaseUrl } from '@lib/constants';
import { awsUrlFor } from '@lib/fetch-retry';
import { logToFile } from '@utils/debug';
import { ServiceHealthStatus, type BaseHealthResult } from './types';

// HTTP failures or unusable downloads confirm the endpoint is unavailable.
// Network errors alone mean we cannot tell whether the service is down.
const RETRY_BACKOFFS_MS = [500, 2000];

type ResponseValidator = (response: Response) => Promise<void>;
type RedirectMode = 'follow' | 'manual' | 'error';
type FetchOutcome =
  | { kind: 'response'; status: number }
  | {
      kind: 'error';
      error: string;
      httpStatus?: number;
    };

async function attemptFetch(
  url: string,
  timeoutMs: number,
  isExpectedStatus: (status: number) => boolean,
  redirect: RedirectMode,
  validateResponse?: ResponseValidator,
): Promise<FetchOutcome> {
  const controller = new AbortController();
  let httpStatus: number | undefined;
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const request = async (): Promise<FetchOutcome> => {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect,
      });
      httpStatus = response.status;
      if (isExpectedStatus(response.status) && validateResponse) {
        // Keep the deadline active until the body has downloaded and parsed.
        await validateResponse(response);
      } else {
        // Health endpoints only need their status, not their diagnostic body.
        void response.body?.cancel().catch(() => undefined);
      }
      return { kind: 'response', status: response.status };
    };
    return await Promise.race([request(), deadline]);
  } catch (error) {
    return {
      kind: 'error',
      httpStatus,
      error: timedOut
        ? `Request timed out after ${timeoutMs}ms`
        : error instanceof Error
        ? error.message
        : 'Unknown error',
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Probe an endpoint with bounded retries; downloads may also validate the body. */
export async function fetchEndpointHealth(
  url: string,
  timeoutMs = 5000,
  isExpectedStatus: (status: number) => boolean = (status) => status === 200,
  redirect: RedirectMode = 'follow',
  validateResponse?: ResponseValidator,
): Promise<BaseHealthResult> {
  let lastHttpStatus: number | undefined;
  let lastHttpError: string | undefined;
  let lastError = 'Unknown error';
  let attempts = 0;

  for (let i = 0; i <= RETRY_BACKOFFS_MS.length; i++) {
    if (i > 0) {
      const wait = RETRY_BACKOFFS_MS[i - 1];
      logToFile(
        `[health-checks] retry ${i}/${RETRY_BACKOFFS_MS.length} for ${url} in ${wait}ms (last: ${lastError})`,
      );
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    attempts++;
    const outcome = await attemptFetch(
      url,
      timeoutMs,
      isExpectedStatus,
      redirect,
      validateResponse,
    );

    if (outcome.kind === 'response') {
      if (isExpectedStatus(outcome.status)) {
        const result: BaseHealthResult = {
          status: ServiceHealthStatus.Healthy,
          rawIndicator:
            attempts > 1
              ? `HTTP ${outcome.status} (attempts=${attempts})`
              : `HTTP ${outcome.status}`,
        };
        logToFile(
          `[health-checks] GET ${url} -> ${result.status} (${
            result.rawIndicator ?? ''
          })`,
        );
        return result;
      }
      lastHttpStatus = outcome.status;
      lastError = lastHttpError = `HTTP ${outcome.status}`;
    } else {
      lastError = outcome.error;
      if (outcome.httpStatus !== undefined) {
        lastHttpStatus = outcome.httpStatus;
        lastHttpError = outcome.error;
      }
    }
  }

  const result: BaseHealthResult = {
    status:
      lastHttpStatus !== undefined
        ? ServiceHealthStatus.Down
        : ServiceHealthStatus.NoConnection,
    error: lastHttpError ?? lastError,
    rawIndicator:
      lastHttpStatus !== undefined
        ? `HTTP ${lastHttpStatus} (attempts=${attempts})`
        : `attempts=${attempts}`,
  };
  logToFile(
    `[health-checks] GET ${url} -> ${result.status} (attempts=${attempts}, ${
      lastHttpError ?? lastError
    })`,
  );
  return result;
}

/** Readiness checks gateway dependencies, independently of its model providers. */
export const checkLlmGatewayHealth = (
  gatewayUrl: string,
): Promise<BaseHealthResult> =>
  fetchEndpointHealth(new URL('/readyz', gatewayUrl).href);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate fields consumed by fetchSkillMenu, allowing optional newer metadata. */
async function validateSkillMenu(response: Response): Promise<void> {
  const menu: unknown = await response.json();
  if (!isRecord(menu) || !isRecord(menu.categories)) {
    throw new Error('Skill menu is missing its categories');
  }
  const categories = Object.values(menu.categories);
  const valid = categories.every(
    (entries) =>
      Array.isArray(entries) &&
      entries.every(
        (entry: unknown) =>
          isRecord(entry) &&
          ['id', 'name', 'downloadUrl'].every(
            (key) => typeof entry[key] === 'string' && entry[key].length > 0,
          ) &&
          (entry.variants === undefined ||
            (Array.isArray(entry.variants) &&
              entry.variants.every(
                (variant: unknown) =>
                  isRecord(variant) && typeof variant.id === 'string',
              ))),
      ),
  );
  if (!valid || !categories.some((entries) => (entries as unknown[]).length)) {
    throw new Error('Skill menu has no usable skill entries');
  }
}

/** Probe the actual skill sources, including the matching release's AWS mirror. */
export async function checkSkillsOriginHealth(
  skillsBaseUrl = getSkillsBaseUrl(),
): Promise<BaseHealthResult> {
  const primaryUrl = `${skillsBaseUrl.replace(/\/+$/, '')}/skill-menu.json`;
  const fallbackUrl = awsUrlFor(primaryUrl);
  const probe = (url: string) =>
    fetchEndpointHealth(
      url,
      5000,
      (status) => status === 200,
      'follow',
      validateSkillMenu,
    );

  // Local and custom sources have no production fallback in fetchWithRetry.
  if (!fallbackUrl) return probe(primaryUrl);

  const [primary, fallback] = await Promise.all([
    probe(primaryUrl),
    probe(fallbackUrl),
  ]);
  if (primary.status === ServiceHealthStatus.Healthy) return primary;
  if (fallback.status === ServiceHealthStatus.Healthy) return fallback;

  logToFile(
    `[health-checks] skill origins unavailable: primary=${
      primary.error ?? 'unknown'
    }; fallback=${fallback.error ?? 'unknown'}`,
  );
  return {
    status:
      primary.status === ServiceHealthStatus.Down ||
      fallback.status === ServiceHealthStatus.Down
        ? ServiceHealthStatus.Down
        : ServiceHealthStatus.NoConnection,
    error: 'Both skill download sources are unavailable',
    rawIndicator: primary.rawIndicator ?? fallback.rawIndicator,
  };
}
