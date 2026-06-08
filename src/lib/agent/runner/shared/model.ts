import type { createAnthropic } from '@ai-sdk/anthropic';
import { readGatewayEnv, buildGatewayHeaders } from './gateway';

/**
 * The provider model `@ai-sdk/anthropic` returns. Derived from the provider so
 * we don't depend on `@ai-sdk/provider` (a transitive dep) for its name — and so
 * the precise model type flows to both consumers: the `vercel` runner's
 * `ToolLoopAgent` (which also accepts a bare id) and the `pi` runner's `aisdk()`
 * adapter (which rejects the bare-id form, so it needs this exact type).
 */
type GatewayModel = ReturnType<ReturnType<typeof createAnthropic>>;

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
): Promise<GatewayModel> {
  const { createAnthropic } = await import('@ai-sdk/anthropic');
  const { baseUrl, authToken } = readGatewayEnv();
  return createAnthropic({
    baseURL: baseUrl,
    authToken,
    headers: buildGatewayHeaders(wizardMetadata, wizardFlags),
  })(modelId);
}
