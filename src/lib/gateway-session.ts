/**
 * Gateway auth for a wizard run. The new Go ai-gateway authenticates scoped
 * `phe_` tokens that PostHog mints server-side (pinned product/obo attribution,
 * per-run spend cap, expiry) instead of the user's OAuth token. This module
 * asks the wizard backend for one and falls back to the legacy posture (OAuth
 * token against the Python gateway's `/wizard` slug) when the backend doesn't
 * mint — an older server, the rollout flag off, or a network failure. The
 * backend response carries the gateway URL, so rollout percentage is
 * server-controlled with no CLI release.
 */

import { logToFile } from '@utils/debug';
import type { HostResolution } from '@lib/host-resolution';

export type GatewayEdition = 'legacy' | 'v2';

export interface GatewayAuth {
  /** Base URL for model calls (no `/v1`; transports append their route). */
  gatewayUrl: string;
  /** Bearer for the gateway: a minted `phe_` (v2) or the OAuth token (legacy). */
  token: string;
  /**
   * Which gateway contract the run speaks. v2 (the Go ai-gateway) takes run
   * metadata as one `X-PostHog-Properties` JSON blob and has native Bedrock
   * fallback; legacy takes per-key `X-POSTHOG-PROPERTY-*` headers and the
   * explicit fallback opt-in header.
   */
  edition: GatewayEdition;
  /**
   * The customer team the mint verified (v2 only). Rides the properties blob
   * as `team_id` so dashboards keep a team breakdown next to the org-level
   * obo attribution the token pins.
   */
  teamId?: number;
}

interface CachedAuth {
  key: string;
  auth: GatewayAuth;
  /** Re-resolve after this instant (token expiry minus slack, or retry backoff). */
  staleAtMs: number;
}

let cached: CachedAuth | null = null;
/**
 * In-flight resolution, so concurrent callers share one mint. The orchestrator
 * starts every runnable task at once; without this each would mint its own
 * token, each with its own spend cap, and only the last would be remembered.
 */
let inFlight: { key: string; promise: Promise<GatewayAuth> } | null = null;

/**
 * A token is adopted only with at least this much life left. Below it the
 * anthropic subprocess, which holds its credential for the whole session, would
 * 401 mid-run; falling back beats that.
 */
const MIN_USABLE_TTL_MS = 2 * 60 * 1000;
/**
 * Re-resolve once this much of the token's life is gone, so a caller near the
 * end of the window still has a usable remainder.
 */
const REFRESH_AT_FRACTION = 0.8;
/** How long a legacy fallback sticks before the mint endpoint is retried. */
const LEGACY_RETRY_MS = 10 * 60 * 1000;
const MINT_TIMEOUT_MS = 10_000;

/**
 * Resolve the gateway auth for this run, minting (and re-minting near expiry)
 * through the wizard backend. Never throws: any mint failure resolves to the
 * legacy posture so a run degrades to today's behavior instead of dying.
 */
export async function gatewayAuth(
  host: HostResolution,
  accessToken: string,
): Promise<GatewayAuth> {
  const key = `${host.apiHost}\n${accessToken}`;
  if (cached && cached.key === key && Date.now() < cached.staleAtMs) {
    return cached.auth;
  }
  if (inFlight && inFlight.key === key) return inFlight.promise;
  const promise = resolveGatewayAuth(host, accessToken, key);
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
): Promise<GatewayAuth> {
  const minted = await mintGatewayToken(host, accessToken);
  if (!minted) {
    const auth = legacyAuth(host, accessToken);
    cached = { key, auth, staleAtMs: Date.now() + LEGACY_RETRY_MS };
    return auth;
  }
  const expiresAtMs = Date.parse(minted.expiresAt);
  const ttlMs = expiresAtMs - Date.now();
  if (Number.isFinite(expiresAtMs) && ttlMs < MIN_USABLE_TTL_MS) {
    // Expired, or too short to serve a session. Falling back beats a
    // credential that 401s mid-run.
    logToFile(
      `[gateway] mint returned a token with ${ttlMs}ms of life; staying on the existing gateway`,
    );
    const auth = legacyAuth(host, accessToken);
    cached = { key, auth, staleAtMs: Date.now() + LEGACY_RETRY_MS };
    return auth;
  }
  const staleAtMs = Number.isFinite(expiresAtMs)
    ? Date.now() + ttlMs * REFRESH_AT_FRACTION
    : Date.now() + LEGACY_RETRY_MS;
  const auth: GatewayAuth = {
    gatewayUrl: minted.gatewayUrl,
    token: minted.token,
    edition: 'v2',
    teamId: minted.teamId,
  };
  cached = { key, auth, staleAtMs };
  return auth;
}

/** Today's posture: the user's OAuth token against the existing gateway. */
function legacyAuth(host: HostResolution, accessToken: string): GatewayAuth {
  return { gatewayUrl: host.gatewayUrl, token: accessToken, edition: 'legacy' };
}

/** Test hook: drop the cached auth so the next call re-resolves. */
export function resetGatewaySession(): void {
  cached = null;
  inFlight = null;
}

/**
 * Whether a server-supplied gateway origin is one we will send a bearer and
 * prompt content to: https, and either a posthog.com host or the same host the
 * run already authenticated against (which covers dev and self-hosted).
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
 * POST the wizard backend's mint endpoint. Null means "no v2 token" for any
 * reason — 404 from an older server, 403 with the rollout flag off, malformed
 * response, or a network failure — and the caller falls back to legacy.
 */
async function mintGatewayToken(
  host: HostResolution,
  accessToken: string,
): Promise<MintedToken | null> {
  try {
    const resp = await fetch(`${host.apiHost}/api/wizard/gateway_token/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
    });
    if (!resp.ok) {
      logToFile(
        `[gateway] mint refused with HTTP ${resp.status}; staying on the existing gateway`,
      );
      return null;
    }
    const body = (await resp.json()) as {
      token?: string;
      expires_at?: string;
      gateway_url?: string;
      team_id?: number;
    };
    // Checked one at a time, not in a loop, so each clause narrows the optional
    // field for the return below and each names itself in the log.
    if (!body.token) {
      logToFile(
        '[gateway] mint response omitted token; staying on the existing gateway',
      );
      return null;
    }
    if (!body.expires_at) {
      logToFile(
        '[gateway] mint response omitted expires_at; staying on the existing gateway',
      );
      return null;
    }
    if (!body.gateway_url) {
      logToFile(
        '[gateway] mint response omitted gateway_url; staying on the existing gateway',
      );
      return null;
    }
    if (!isTrustedGatewayUrl(body.gateway_url, host.apiHost)) {
      logToFile(
        `[gateway] mint returned an untrusted gateway url; staying on the existing gateway`,
      );
      return null;
    }
    return {
      token: body.token,
      expiresAt: body.expires_at,
      gatewayUrl: body.gateway_url.replace(/\/+$/, ''),
      teamId: body.team_id,
    };
  } catch (e) {
    logToFile(
      `[gateway] mint call failed (${String(
        e,
      )}); staying on the existing gateway`,
    );
    return null;
  }
}

/**
 * The v2 run-metadata carrier: one JSON blob for the `X-PostHog-Properties`
 * header. Plain keys only — the gateway strips `$`-prefixed keys as reserved,
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
