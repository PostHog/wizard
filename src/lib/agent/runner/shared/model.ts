import type { LanguageModel } from 'ai';
import { readGatewayEnv, buildGatewayHeaders } from './gateway';

/**
 * Build the gateway-pointed `@ai-sdk/anthropic` model both runners use.
 *
 * `@ai-sdk/anthropic` speaks the Anthropic Messages protocol the PostHog gateway
 * already serves, so we reuse the same transport inputs as the Anthropic SDK
 * path: `baseURL`/`authToken` from the env `initializeAgent` set, and the
 * Bedrock-fallback + wizard metadata/flag headers `buildAgentEnv` encodes. The
 * `vercel` runner drives this model directly; the `pi` runner wraps it with the
 * `aisdk()` adapter. The model id passes through verbatim (a bare id like
 * `claude-sonnet-4-6`) so the gateway's Bedrock fallback can match it.
 *
 * The provider is imported dynamically — the AI SDK is ESM-only, mirroring
 * agent-interface's `getSDKModule`.
 */
export async function createGatewayAnthropicModel(
  modelId: string,
  wizardMetadata: Record<string, string>,
  wizardFlags: Record<string, string>,
): Promise<LanguageModel> {
  const { createAnthropic } = await import('@ai-sdk/anthropic');
  const { baseUrl, authToken } = readGatewayEnv();
  return createAnthropic({
    baseURL: baseUrl,
    authToken,
    headers: buildGatewayHeaders(wizardMetadata, wizardFlags),
  })(modelId);
}
