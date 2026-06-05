import type { Model } from '@openai/agents';
import { readGatewayEnv, buildGatewayHeaders } from '../shared/gateway';

/**
 * Build the OpenAI Agents SDK model for the `pi` runner, pointed at the PostHog
 * LLM gateway.
 *
 * The OpenAI Agents SDK is model-agnostic through `@openai/agents-extensions`'
 * `aisdk()` adapter, which wraps any Vercel AI SDK model as an Agents `Model`.
 * We wrap the same gateway-pointed `@ai-sdk/anthropic` model the `vercel`
 * runner uses, so both challengers hit the gateway identically (bearer auth +
 * Bedrock-fallback + wizard metadata/flag headers) and only the surrounding
 * loop differs.
 *
 * The model id passes through verbatim (a bare id like `claude-sonnet-4-6`) so
 * the gateway's Bedrock fallback can match it. Both SDKs are ESM-only, so they
 * load dynamically — mirroring agent-interface's `getSDKModule`.
 */
export async function createPiModel(
  modelId: string,
  wizardMetadata: Record<string, string>,
  wizardFlags: Record<string, string>,
): Promise<Model> {
  const { createAnthropic } = await import('@ai-sdk/anthropic');
  // `aisdk` lives on the package's `/ai-sdk` subpath, not the root export.
  const { aisdk } = await import('@openai/agents-extensions/ai-sdk');
  const { baseUrl, authToken } = readGatewayEnv();
  const anthropic = createAnthropic({
    baseURL: baseUrl,
    authToken,
    headers: buildGatewayHeaders(wizardMetadata, wizardFlags),
  });
  return aisdk(anthropic(modelId));
}
