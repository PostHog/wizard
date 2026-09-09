// CI-only fallback to the legacy Python gateway for the personal API key the mint refuses; delete this file and every `legacy` reference to rip it out.

import type { GatewayAuth } from '@lib/gateway-session';
import type { HostResolution } from '@lib/host-resolution';

let enabled = false;

/** Only the `--ci` runner turns this on. */
export function setLegacyGatewayFallback(on: boolean): void {
  enabled = on;
}

/** Legacy auth when the fallback is on and the mint cannot serve this credential (401, or 404 without the endpoint). */
export function legacyGatewayAuth(
  host: HostResolution,
  accessToken: string,
  mintStatus: number,
): GatewayAuth | undefined {
  if (!enabled || (mintStatus !== 401 && mintStatus !== 404)) return undefined;
  return {
    gatewayUrl: legacyGatewayUrl(host.apiHost),
    token: accessToken,
    legacy: true,
    // Nothing re-mints this bearer, so a 401 on it is always a bad credential.
    refreshAtMs: Number.POSITIVE_INFINITY,
  };
}

function legacyGatewayUrl(apiHost: string): string {
  if (apiHost.includes('host.docker.internal')) {
    return 'http://host.docker.internal:3308/wizard';
  }
  if (apiHost.includes('localhost')) return 'http://localhost:3308/wizard';
  if (
    apiHost.includes('eu.posthog.com') ||
    apiHost.includes('eu.i.posthog.com')
  ) {
    return 'https://gateway.eu.posthog.com/wizard';
  }
  return 'https://gateway.us.posthog.com/wizard';
}

/** The legacy gateway reads per-key metadata and flag headers and needs an explicit Bedrock opt-in. */
export function legacyGatewayHeaders(
  wizardMetadata: Record<string, string>,
  wizardFlags: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    'x-posthog-use-bedrock-fallback': 'true',
  };
  for (const [key, value] of Object.entries(wizardMetadata)) {
    headers[
      key.startsWith('X-POSTHOG-PROPERTY-') ? key : `X-POSTHOG-PROPERTY-${key}`
    ] = value;
  }
  for (const [flagKey, variant] of Object.entries(wizardFlags)) {
    if (!flagKey.toLowerCase().startsWith('wizard')) continue;
    headers[`X-POSTHOG-FLAG-${flagKey.toUpperCase()}`] = variant;
  }
  return headers;
}
