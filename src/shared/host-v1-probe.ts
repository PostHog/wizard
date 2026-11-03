/**
 * Whether a PostHog host serves the capture v1 routes. Cloud regions always
 * do; a `--base-url` host may be a self-hosted build from before the routes
 * existed, or one that serves analytics but not the AI lane, and a v1 SDK
 * pointed at it retries 404s until its queue evicts the events. One
 * unauthenticated POST per route answers the question: capture v1 refuses a
 * bare request with `401 {"error":"missing_authorization"}`.
 */
import type { HostV1Answer } from './sdk-capture-mode';
import { logToFile } from '@utils/debug';

const PROBE_TIMEOUT_MS = 5_000;
/** Both lanes must answer; a deployment can serve one without the other. */
export const V1_ROUTES = ['/i/v1/analytics/events', '/i/v1/ai/events'] as const;

export interface HostV1ProbeOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** The run's abort signal; an aborted run stops waiting on the host. */
  signal?: AbortSignal;
}

/** PostHog Cloud ingestion hosts: every `*.posthog.com` origin serves the v1 routes. */
export function isCloudApiHost(apiHost: string): boolean {
  try {
    const { hostname } = new URL(apiHost);
    return hostname === 'posthog.com' || hostname.endsWith('.posthog.com');
  } catch {
    return false;
  }
}

async function probeRoute(
  apiHost: string,
  route: string,
  options: HostV1ProbeOptions,
): Promise<HostV1Answer> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, options.timeoutMs ?? PROBE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${apiHost.replace(/\/+$/, '')}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      // A redirect would turn the POST into a GET; a host that redirects does not answer here.
      redirect: 'manual',
      signal: controller.signal,
    });
    const body = await response.text();
    const servesV1 =
      response.status === 401 && body.includes('missing_authorization');
    logToFile(
      `[host-v1-probe] ${apiHost}${route}: ${response.status} -> ${
        servesV1 ? 'serves v1' : 'no v1 route'
      }`,
    );
    return servesV1;
  } catch (error) {
    logToFile(`[host-v1-probe] ${apiHost}${route}: ${String(error)}`);
    return 'unreachable';
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

/**
 * `true` only when both routes give the capture v1 refusal; `false` when either
 * answers something else; `unreachable` when neither answered otherwise and at
 * least one did not answer at all.
 */
export async function probeV1Routes(
  apiHost: string,
  options: HostV1ProbeOptions = {},
): Promise<HostV1Answer> {
  const answers = await Promise.all(
    V1_ROUTES.map((route) => probeRoute(apiHost, route, options)),
  );
  if (answers.some((answer) => answer === false)) return false;
  if (answers.some((answer) => answer === 'unreachable')) return 'unreachable';
  return true;
}

/**
 * `undefined` for a cloud host (not probed, serves v1), else the probe result.
 * Matches the resolver's `hostServesV1` input.
 */
export async function hostServesCaptureV1(
  apiHost: string,
  options: HostV1ProbeOptions = {},
): Promise<HostV1Answer | undefined> {
  if (isCloudApiHost(apiHost)) return undefined;
  return probeV1Routes(apiHost, options);
}
