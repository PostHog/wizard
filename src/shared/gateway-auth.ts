/** Gateway bearer types and checks shared by the agent and its hosts. */

export interface GatewayAuth {
  /** Base URL for model calls (no `/v1`; transports append their route). */
  gatewayUrl: string;
  /** Gateway bearer, minted normally or supplied directly by CI. */
  token: string;
  /** Team verified by the mint, or explicitly supplied for CI attribution. */
  teamId?: number;
  /**
   * Instant past which a 401 on this bearer is age rather than a bad
   * credential: the cache re-mints past it, and a session still holding the
   * old bearer may re-mint once. Before it the mint has to be trusted.
   */
  refreshAtMs: number;
}

/** Whether a 401 on this bearer may be age (past its refresh instant) rather than a bad credential. */
export function isPastRefresh(auth: GatewayAuth, now = Date.now()): boolean {
  return now >= auth.refreshAtMs;
}

/**
 * Whether a server-supplied origin may receive a bearer and prompt content:
 * https (loopback excepted), and either a current cloud gateway or the host the run
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
  if (url.hostname.endsWith('.posthog.com')) {
    return (
      url.origin === 'https://ai-gateway.us.posthog.com' ||
      url.origin === 'https://ai-gateway.eu.posthog.com'
    );
  }
  try {
    return url.hostname === new URL(apiHost).hostname;
  } catch {
    return false;
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
  // The gateway pins `$ai_product` to `wizard:<program>`, and rejects a legacy
  // product override on a scoped token, so the unprefixed key every cost and
  // error consumer reads is only present if this blob declares it.
  const props: Record<string, string | number> = { ai_product: 'wizard' };
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
