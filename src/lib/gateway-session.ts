/**
 * Gateway auth for a wizard run: a `phe_` scoped token the backend mints, with
 * pinned attribution, a spend cap and an expiry.
 *
 * A 404 resolves to the legacy posture (OAuth token, Python gateway); every
 * other failure throws, because the legacy path enforces none of those, so a
 * silent downgrade spends unattributed money to hide an outage.
 */

import { logToFile } from '@utils/debug';
import { analytics } from '@utils/analytics';
import type { HostResolution } from '@lib/host-resolution';

export type GatewayEdition = 'legacy' | 'v2';

export interface GatewayAuth {
  /** Base URL for model calls (no `/v1`; transports append their route). */
  gatewayUrl: string;
  /** Bearer for the gateway: a minted `phe_` (v2) or the OAuth token (legacy). */
  token: string;
  /** Selects the header shape: one properties blob (v2) or per-key headers. */
  edition: GatewayEdition;
  /** The team the mint verified; rides the blob so dashboards keep a breakdown. */
  teamId?: number;
}

interface CachedAuth {
  key: string;
  auth: GatewayAuth;
  /** Re-resolve once past this instant. */
  staleAtMs: number;
}

let cached: CachedAuth | null = null;
/**
 * Shared so concurrent callers mint once. The orchestrator starts every runnable
 * task at once, and each would otherwise take its own token and its own cap.
 */
let inFlight: { key: string; promise: Promise<GatewayAuth> } | null = null;

/**
 * Adoption floor. The anthropic subprocess holds its credential for the whole
 * session, so a token below this 401s mid-run.
 */
const MIN_USABLE_TTL_MS = 2 * 60 * 1000;
/** Re-resolve at this fraction of the token's life, leaving a usable remainder. */
const REFRESH_AT_FRACTION = 0.8;
/** How long a legacy fallback sticks before the mint endpoint is retried. */
const LEGACY_RETRY_MS = 10 * 60 * 1000;
// Exceeds the backend's own 10s gateway timeout: a slow mint that lands after the
// CLI hangs up spends a daily mint and orphans a live token.
const MINT_TIMEOUT_MS = 20_000;

/** Resolve this run's gateway auth, minting and re-minting near expiry. */
export async function gatewayAuth(
  host: HostResolution,
  accessToken: string,
  program: string | undefined,
): Promise<GatewayAuth> {
  // Keyed by program: a token pins `wizard:<program>`, so reusing one across
  // programs bills the wrong budget.
  const key = `${host.apiHost}\n${accessToken}\n${program ?? ''}`;
  if (cached && cached.key === key && Date.now() < cached.staleAtMs) {
    return cached.auth;
  }
  if (inFlight && inFlight.key === key) return inFlight.promise;
  const promise = resolveGatewayAuth(host, accessToken, key, program);
  inFlight = { key, promise };
  try {
    return await promise;
  } finally {
    if (inFlight?.promise === promise) inFlight = null;
  }
}

async function resolveGatewayAuth(
  host: HostResolution,
  accessToken: string,
  key: string,
  program: string | undefined,
): Promise<GatewayAuth> {
  if (!program) {
    // Every run has one; absent means a caller was not wired, and the spend would
    // be unattributable.
    logToFile('[gateway] run has no program id; failing the run');
    throw new GatewayMintFailed(
      'this run has no program to attribute its spend to',
    );
  }
  const minted = await mintGatewayToken(host, accessToken, program);
  if (!minted) {
    // The mint is not enabled here, or does not recognise this credential.
    analytics.setTag('gateway_edition', 'legacy');
    const auth = legacyAuth(host, accessToken);
    cached = { key, auth, staleAtMs: Date.now() + LEGACY_RETRY_MS };
    return auth;
  }
  const expiresAtMs = Date.parse(minted.expiresAt);
  const ttlMs = expiresAtMs - Date.now();
  if (!Number.isFinite(expiresAtMs) || ttlMs < MIN_USABLE_TTL_MS) {
    // Expired, unreadable, or too short to serve a session. Adopting it would
    // 401 mid-run, and downgrading would spend the rest of the run uncapped.
    logToFile(
      `[gateway] mint returned a token with ${ttlMs}ms of life; failing the run`,
    );
    throw new GatewayMintFailed(
      `the PostHog gateway issued a token with ${ttlMs}ms of life`,
    );
  }
  const staleAtMs = Date.now() + ttlMs * REFRESH_AT_FRACTION;
  analytics.setTag('gateway_edition', 'v2');
  const auth: GatewayAuth = {
    gatewayUrl: minted.gatewayUrl,
    token: minted.token,
    edition: 'v2',
    teamId: minted.teamId,
  };
  cached = { key, auth, staleAtMs };
  return auth;
}

/** The legacy posture: the user's OAuth token against the Python gateway. */
function legacyAuth(host: HostResolution, accessToken: string): GatewayAuth {
  return { gatewayUrl: host.gatewayUrl, token: accessToken, edition: 'legacy' };
}

/** Test hook: drop the cached auth so the next call re-resolves. */
export function resetGatewaySession(): void {
  cached = null;
  inFlight = null;
}

/**
 * Whether a server-supplied origin may receive a bearer and prompt content:
 * https (loopback excepted), and either a posthog.com host or the one the run
 * authenticated against.
 */
export function isTrustedGatewayUrl(value: string, apiHost: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  // Consumers append routes to this value, so anything beyond an origin
  // (path, query, fragment, userinfo) would build a malformed endpoint.
  if (
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    return false;
  }
  const localhost =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === 'host.docker.internal';
  // Loopback is the dev gateway, and is the one case allowed over http.
  if (localhost) return true;
  if (url.protocol !== 'https:') return false;
  if (url.hostname.endsWith('.posthog.com')) return true;
  try {
    return url.hostname === new URL(apiHost).hostname;
  } catch {
    return false;
  }
}

interface MintedToken {
  token: string;
  expiresAt: string;
  gatewayUrl: string;
  teamId?: number;
}

/**
 * A deliberate refusal from the mint endpoint, as opposed to the mint being
 * unavailable. Thrown rather than folded into the legacy fallback, so the run
 * stops instead of proceeding without the controls the refusal was enforcing.
 */
export class GatewayMintRefused extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GatewayMintRefused';
    this.status = status;
  }
}

/**
 * The mint could not produce a usable credential: unreachable, a 5xx, or a
 * response the client cannot use.
 */
export class GatewayMintFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayMintFailed';
  }
}

/**
 * Whether a mint status means "refused this run" rather than "not available".
 * These are the statuses the endpoint returns after it has authenticated the
 * caller: 429 the daily run limit, 403 revoked project access, 400 a login
 * covering more than one project. 404 and 401 fall back instead.
 */
function isMintRefusal(status: number): boolean {
  return status === 400 || status === 403 || status === 429;
}

function mintRefusalMessage(status: number): string {
  switch (status) {
    case 429:
      return 'This wizard program has used its daily run limit. Try again tomorrow.';
    case 403:
      return 'Your access to this project has changed. Re-authenticate and try again.';
    case 400:
      // The only 400 the mint answers is the exactly-one-project check; an
      // unrecognised program is a 404 and falls back instead.
      return 'Your PostHog login must cover exactly one project. Re-authenticate and try again.';
    default:
      return 'The PostHog gateway refused this run.';
  }
}

async function mintGatewayToken(
  host: HostResolution,
  accessToken: string,
  program: string,
): Promise<MintedToken | null> {
  try {
    const resp = await fetch(`${host.apiHost}/api/wizard/gateway_token/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ program }),
      signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
    });
    if (!resp.ok) {
      if (isMintRefusal(resp.status)) {
        logToFile(
          `[gateway] mint refused with HTTP ${resp.status}; failing the run`,
        );
        throw new GatewayMintRefused(
          resp.status,
          mintRefusalMessage(resp.status),
        );
      }
      if (resp.status === 404 || resp.status === 401) {
        // 404 is the rollout switch. 401 is a credential the mint does not
        // recognise, an API key rather than an OAuth login; the legacy gateway
        // authenticates it separately, so falling back grants nothing.
        logToFile(
          `[gateway] mint unavailable for this credential (HTTP ${resp.status}); staying on the existing gateway`,
        );
        return null;
      }
      logToFile(
        `[gateway] mint failed with HTTP ${resp.status}; failing the run`,
      );
      throw new GatewayMintFailed(
        `the PostHog gateway could not issue a token (HTTP ${resp.status})`,
      );
    }
    const body = (await resp.json()) as {
      token?: string;
      expires_at?: string;
      gateway_url?: string;
      team_id?: number;
    };
    // Checked one at a time, not in a loop, so each clause narrows the optional
    // field for the return below and each names itself in the failure.
    if (!body.token) {
      logToFile('[gateway] mint response omitted token; failing the run');
      throw new GatewayMintFailed('mint response omitted token');
    }
    if (!body.expires_at) {
      logToFile('[gateway] mint response omitted expires_at; failing the run');
      throw new GatewayMintFailed('mint response omitted expires_at');
    }
    if (!body.gateway_url) {
      logToFile('[gateway] mint response omitted gateway_url; failing the run');
      throw new GatewayMintFailed('mint response omitted gateway_url');
    }
    if (!isTrustedGatewayUrl(body.gateway_url, host.apiHost)) {
      logToFile(
        '[gateway] mint returned an untrusted gateway url; failing the run',
      );
      throw new GatewayMintFailed('mint returned an untrusted gateway url');
    }
    return {
      token: body.token,
      expiresAt: body.expires_at,
      gatewayUrl: body.gateway_url.replace(/\/+$/, ''),
      teamId: body.team_id,
    };
  } catch (e) {
    // Decisions and failures both pass through: this catch exists for transport
    // errors, and folding the others into it would restore the downgrade.
    if (e instanceof GatewayMintRefused || e instanceof GatewayMintFailed)
      throw e;
    logToFile(
      `[gateway] mint transport failure (${String(e)}); failing the run`,
    );
    throw new GatewayMintFailed(
      `could not reach the PostHog gateway (${String(e)})`,
    );
  }
}

/**
 * The v2 run-metadata carrier: one JSON blob for the `X-PostHog-Properties`
 * header. Plain keys only, since the gateway strips `$`-prefixed keys as reserved,
 * so feature-flag variants land as `wizard_flag_<key>` instead of the legacy
 * `$feature/<key>` (dashboards keying on `$feature/wizard-*` read the new key
 * post-cutover).
 */
export function buildWizardPropertiesBlob(
  wizardMetadata: Record<string, string>,
  wizardFlags: Record<string, string>,
  teamId?: number,
): string {
  const props: Record<string, string | number> = {};
  if (teamId !== undefined) props.team_id = teamId;
  for (const [key, value] of Object.entries(wizardMetadata)) {
    props[stripPropertyPrefix(key)] = value;
  }
  for (const [flagKey, variant] of Object.entries(wizardFlags)) {
    if (!flagKey.toLowerCase().startsWith('wizard')) continue;
    props[`wizard_flag_${flagKey.toLowerCase()}`] = variant;
  }
  return JSON.stringify(props);
}

const LEGACY_PROPERTY_PREFIX = 'X-POSTHOG-PROPERTY-';

function stripPropertyPrefix(key: string): string {
  return key.toUpperCase().startsWith(LEGACY_PROPERTY_PREFIX)
    ? key.slice(LEGACY_PROPERTY_PREFIX.length).toLowerCase()
    : key;
}
