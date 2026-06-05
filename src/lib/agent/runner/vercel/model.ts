import type { LanguageModel } from 'ai';
import { readGatewayEnv, buildGatewayHeaders } from '../shared/gateway';

/**
 * Build the Vercel AI SDK language model pointed at the PostHog LLM gateway.
 *
 * `@ai-sdk/anthropic` speaks the Anthropic Messages protocol, which is exactly
 * what the gateway exposes (the Anthropic SDK path already talks to it). We
 * reuse the same transport inputs the SDK path uses:
 *   - `baseURL`   ← `ANTHROPIC_BASE_URL` (gateway root, set by initializeAgent)
 *   - `authToken` ← `ANTHROPIC_AUTH_TOKEN` (bearer; the PostHog project key)
 *   - `headers`   ← the Bedrock-fallback + wizard metadata/flag headers that
 *                   `buildAgentEnv` encodes for the SDK path.
 *
 * The model id is passed through verbatim from `agentConfig.model` (a bare id
 * like `claude-sonnet-4-6`, no `anthropic/` prefix) so the gateway's Bedrock
 * fallback can match it. The provider is imported dynamically — the AI SDK is
 * ESM-only, so loading it lazily mirrors agent-interface's `getSDKModule`.
 */
export async function createGatewayModel(
  modelId: string,
  wizardMetadata: Record<string, string>,
  wizardFlags: Record<string, string>,
): Promise<LanguageModel> {
  const { createAnthropic } = await import('@ai-sdk/anthropic');
  const { baseUrl, authToken } = readGatewayEnv();
  const anthropic = createAnthropic({
    baseURL: baseUrl,
    authToken,
    headers: buildGatewayHeaders(wizardMetadata, wizardFlags),
  });
  return anthropic(modelId);
}
