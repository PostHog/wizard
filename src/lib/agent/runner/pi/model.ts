import type { Model } from '@openai/agents';
import { createGatewayAnthropicModel } from '../shared/model';

/**
 * Build the OpenAI Agents SDK model for the `pi` runner.
 *
 * The OpenAI Agents SDK is model-agnostic through `@openai/agents-extensions`'
 * `aisdk()` adapter, which wraps any Vercel AI SDK model as an Agents `Model`.
 * We wrap the same gateway-pointed `@ai-sdk/anthropic` model the `vercel` runner
 * drives directly — built by the shared {@link createGatewayAnthropicModel}, so
 * both challengers hit the gateway identically (bearer auth + Bedrock-fallback +
 * wizard metadata/flag headers) and only the surrounding loop differs.
 *
 * `@openai/agents-extensions` is ESM-only, so it loads dynamically — mirroring
 * agent-interface's `getSDKModule`.
 */
export async function createPiModel(
  modelId: string,
  wizardMetadata: Record<string, string>,
  wizardFlags: Record<string, string>,
): Promise<Model> {
  // `aisdk` lives on the package's `/ai-sdk` subpath, not the root export.
  const { aisdk } = await import('@openai/agents-extensions/ai-sdk');
  return aisdk(
    await createGatewayAnthropicModel(modelId, wizardMetadata, wizardFlags),
  );
}
