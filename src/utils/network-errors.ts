/**
 * Classification for outbound HTTP failures that come from the user's network
 * rather than from the wizard.
 *
 * Machines behind a TLS-intercepting corporate proxy — or simply missing an
 * intermediate CA — fail every HTTPS request before it reaches PostHog. Call
 * sites that already degrade gracefully (fallback copy, cached value, empty
 * result) were still reporting those throws to error tracking, which buries
 * real wizard bugs under environment noise. Same problem, and same shape of
 * answer, as `BENIGN_FS_ERROR_CODES` in `bounded-fs.ts`: recognise the
 * expected-and-handled failures, log them to the debug file, and keep error
 * tracking for things we can actually act on.
 *
 * Pure predicates — no logging, no capture, no UI. Callers decide.
 */

/**
 * OpenSSL / Node certificate-verification failures. Every one of these means
 * "this machine does not trust the chain it was served", which is a property
 * of the user's trust store, never of our request.
 */
const TLS_TRUST_ERROR_CODES = new Set<string>([
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_CHAIN_TOO_LONG',
  'CERT_UNTRUSTED',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/**
 * The same failures as text. Node surfaces the friendly sentence (and drops
 * the OpenSSL code) on some paths, and intermediaries such as axios rebuild
 * the error keeping only the message — so match both.
 */
const TLS_TRUST_MESSAGE =
  /self[- ]signed certificate|unable to verify the first certificate|unable to get local issuer certificate|certificate has expired|certificate is not yet valid|altname/i;

/** Transport-level failures: DNS, connect, reset, timeout. */
const TRANSPORT_ERROR_CODES = new Set<string>([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EPIPE',
  'EPROTO',
  'ERR_NETWORK', // axios
  'ERR_SOCKET_CONNECTION_TIMEOUT',
  'UND_ERR_SOCKET', // undici
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** undici identifies several of its causes by constructor name, not by code. */
const TRANSPORT_ERROR_NAMES = new Set<string>([
  'SocketError',
  'ConnectTimeoutError',
  'HeadersTimeoutError',
  'BodyTimeoutError',
]);

/** Depth cap so a self-referential `cause` can never spin. */
const MAX_CAUSE_DEPTH = 5;

/**
 * The error plus its `cause` ancestry. undici's `fetch` reports every
 * transport failure as an opaque `TypeError: fetch failed` and hangs the real
 * reason off `cause`, so the chain is where the answer usually lives.
 */
function causeChain(error: unknown): Error[] {
  const chain: Error[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (
    current instanceof Error &&
    !seen.has(current) &&
    chain.length < MAX_CAUSE_DEPTH
  ) {
    seen.add(current);
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

function errorCode(error: Error): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

/**
 * True when the failure is a certificate-trust rejection — the signature of a
 * TLS-intercepting proxy or a missing intermediate CA. Separate from
 * `isBenignNetworkError` because this is the one network failure we can hand
 * the user a concrete fix for (see `TLS_TRUST_HINT`).
 */
export function isTlsTrustError(error: unknown): boolean {
  return causeChain(error).some((entry) => {
    const code = errorCode(entry);
    if (code && TLS_TRUST_ERROR_CODES.has(code)) return true;
    return TLS_TRUST_MESSAGE.test(entry.message);
  });
}

/**
 * True when the failure is the user's network, not our code: certificate
 * rejection, DNS failure, refused/reset connection, or timeout.
 *
 * Deliberately transport-only. An HTTP response the server actually sent —
 * 401, 403, 5xx — is not matched here, so real API problems keep flowing to
 * error tracking.
 */
export function isBenignNetworkError(error: unknown): boolean {
  if (isTlsTrustError(error)) return true;
  return causeChain(error).some((entry) => {
    const code = errorCode(entry);
    if (code && TRANSPORT_ERROR_CODES.has(code)) return true;
    if (TRANSPORT_ERROR_NAMES.has(entry.name)) return true;
    // undici's wrapper, when the cause carried nothing recognisable.
    return entry instanceof TypeError && entry.message === 'fetch failed';
  });
}

/**
 * Remediation for a certificate-trust failure. Node's own message already
 * names `--use-system-ca`; this adds the reason and the env-var route, which
 * is what most people on an intercepting proxy actually need.
 */
export const TLS_TRUST_HINT =
  'This usually means a proxy or VPN on your network is intercepting HTTPS. ' +
  'Run Node with --use-system-ca, or set NODE_EXTRA_CA_CERTS to your ' +
  "organization's root certificate.";
