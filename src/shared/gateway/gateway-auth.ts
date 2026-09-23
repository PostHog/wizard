/** Resolved gateway bearer consumed by an agent run. */
export type GatewayAuth = {
  gatewayUrl: string;
  token: string;
  teamId?: number;
  refreshAtMs: number;
};

/** Whether a 401 on this bearer may be age rather than a bad credential. */
export function isPastRefresh(auth: GatewayAuth, now = Date.now()): boolean {
  return now >= auth.refreshAtMs;
}

/** One metadata blob for the gateway's X-PostHog-Properties header. */
export function buildWizardPropertiesBlob(
  wizardMetadata: Record<string, string>,
  wizardFlags: Record<string, string>,
  teamId?: number,
): string {
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

/** Validate the origin before sending it a bearer and prompt content. */
export function isTrustedGatewayUrl(value: string, apiHost: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
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
