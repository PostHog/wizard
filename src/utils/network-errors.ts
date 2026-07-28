/**
 * Transport-failure presentation: deciding whether a failed request is worth
 * retrying, and turning the error into something a user can act on.
 *
 * The motivating case is Node's happy-eyeballs connect. When every resolved
 * address fails, `internalConnectMultiple` rejects with an `AggregateError`
 * whose own `message` is the empty string — the only usable detail
 * (`getaddrinfo ENOTFOUND us.posthog.com`) sits on `errors[0]`. axios copies
 * that empty message straight onto the `AxiosError` it rethrows
 * (`AxiosError.from`), so a caller doing `error.message` prints nothing at all.
 * Everything here is pure so the copy can be unit-tested without a socket.
 */

/**
 * errno/axios codes that mean "the connection didn't work". Every one of these
 * can be a passing condition — DNS still propagating, a laptop waking up, a
 * proxy recycling a connection — so they're worth one more attempt.
 */
const RETRYABLE_CODES = new Set([
  'EAI_AGAIN', // DNS lookup timed out
  'ECONNABORTED', // axios' own request timeout
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND', // DNS lookup failed
  'EPIPE',
  'ERR_NETWORK', // axios, browser/XHR-style transport failure
  'ERR_SOCKET_CONNECTION_TIMEOUT',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT', // undici, used by global fetch
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The next error in wrapped by, or aggregated into, `error`. */
function unwrapOnce(error: Record<string, unknown>): unknown {
  if (Array.isArray(error.errors) && error.errors.length > 0) {
    return error.errors[0];
  }
  return error.cause;
}

export interface NetworkErrorDescription {
  /** First errno/axios code found while unwrapping, if any. */
  code?: string;
  /** First non-empty message found while unwrapping (`''` if there is none). */
  message: string;
}

/**
 * Walk an error's `errors` / `cause` chain for the first usable code and
 * message. Needed because the outermost error — the one a caller naturally
 * reads — is exactly the one with the empty message in the happy-eyeballs case.
 */
export function describeNetworkError(error: unknown): NetworkErrorDescription {
  let code: string | undefined;
  let message = '';
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (isRecord(current) && !seen.has(current)) {
    seen.add(current);
    if (
      code === undefined &&
      typeof current.code === 'string' &&
      current.code
    ) {
      code = current.code;
    }
    if (!message && typeof current.message === 'string') {
      message = current.message.trim();
    }
    if (code !== undefined && message) break;
    current = unwrapOnce(current);
  }

  return { code, message };
}

/**
 * True when `error` is a transport failure that's worth another attempt.
 *
 * An error carrying a `response` is deliberately excluded: the request reached
 * PostHog and came back, so the status is the caller's to interpret, and
 * re-POSTing a request the server has already processed risks doing the work
 * twice.
 */
export function isRetryableNetworkError(error: unknown): boolean {
  if (!isRecord(error) || isRecord(error.response)) return false;

  // A happy-eyeballs AggregateError is by construction a failure to connect,
  // whether or not Node attached a code to the wrapper.
  if (error.name === 'AggregateError' || Array.isArray(error.errors)) {
    return true;
  }

  const { code } = describeNetworkError(error);
  return code !== undefined && RETRYABLE_CODES.has(code);
}

/**
 * A transport failure that never reached PostHog, carrying a message that is
 * safe to show a user. Callers branch on this to distinguish "we couldn't get
 * there" from "PostHog said no".
 */
export class NetworkError extends Error {
  /** The underlying errno/axios code, once unwrapped. */
  readonly code?: string;
  /** Host the request was aimed at. */
  readonly host: string;

  constructor(message: string, host: string, code?: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'NetworkError';
    this.host = host;
    this.code = code;
  }
}

/** Hostname of `url`, or the raw string when it doesn't parse as a URL. */
export function hostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Build the `NetworkError` for a request to `url` that never got a response.
 * The message always names the host and the remediation, so it stays useful
 * even when the underlying error tells us nothing at all.
 */
export function networkErrorFor(
  error: unknown,
  url: string,
  attempts = 1,
): NetworkError {
  const { code, message } = describeNetworkError(error);
  const host = hostLabel(url);

  // Node's messages already embed the code ("getaddrinfo ENOTFOUND host"), so
  // only prepend it when it adds something.
  const detail =
    code && message && !message.includes(code)
      ? `${code}: ${message}`
      : message || code || 'no detail from the network layer';
  const tries = attempts > 1 ? ` after ${attempts} attempts` : '';

  return new NetworkError(
    `Couldn't reach ${host} — check your network, VPN, or proxy and try again. (${detail}${tries})`,
    host,
    code,
    error,
  );
}
