import {
  POSTHOG_FLAG_HEADER_PREFIX,
  POSTHOG_PROPERTY_HEADER_PREFIX,
} from '../../../constants';

/**
 * Gateway transport for the model-agnostic runners.
 *
 * `initializeAgent` already configures the PostHog LLM gateway as env vars for
 * the Anthropic SDK path (`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`). The
 * SDK-agnostic runners read the same values and the same custom headers, so all
 * three backends hit the gateway identically (bearer auth + Bedrock fallback +
 * wizard metadata/flag headers).
 */

export interface GatewayEnv {
  baseUrl: string | undefined;
  authToken: string | undefined;
}

/** Gateway base URL + bearer token, as set by `initializeAgent`. */
export function readGatewayEnv(): GatewayEnv {
  return {
    baseUrl: process.env.ANTHROPIC_BASE_URL,
    authToken:
      process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.CLAUDE_CODE_OAUTH_TOKEN,
  };
}

/**
 * Build the gateway HTTP headers, mirroring `buildAgentEnv` in agent-interface.ts
 * (which encodes the same set into ANTHROPIC_CUSTOM_HEADERS for the SDK). Always
 * sends the Bedrock-fallback header; adds wizard metadata (`X-POSTHOG-PROPERTY-*`)
 * and wizard feature flags (`X-POSTHOG-FLAG-*`).
 */
export function buildGatewayHeaders(
  wizardMetadata: Record<string, string>,
  wizardFlags: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    'x-posthog-use-bedrock-fallback': 'true',
  };
  for (const [key, value] of Object.entries(wizardMetadata)) {
    const name = key.startsWith(POSTHOG_PROPERTY_HEADER_PREFIX)
      ? key
      : `${POSTHOG_PROPERTY_HEADER_PREFIX}${key}`;
    headers[name] = value;
  }
  for (const [flagKey, variant] of Object.entries(wizardFlags)) {
    if (!flagKey.toLowerCase().startsWith('wizard')) continue;
    headers[POSTHOG_FLAG_HEADER_PREFIX + flagKey.toUpperCase()] = variant;
  }
  return headers;
}
