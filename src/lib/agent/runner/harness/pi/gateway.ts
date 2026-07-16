/**
 * PostHog LLM gateway provider spec for pi sessions — shared by the linear run
 * and the orchestrator's per-task runs so both speak to the gateway
 * identically: bearer auth, Bedrock-fallback + wizard metadata/flag headers,
 * transport shape inferred from the model id. The caller registers the spec on
 * its own (lazily imported, properly typed) pi ModelRegistry.
 */

import {
  POSTHOG_FLAG_HEADER_PREFIX,
  POSTHOG_PROPERTY_HEADER_PREFIX,
} from '@lib/constants';
import {
  modelCapabilities,
  type ThinkingLevel,
} from '../../switchboard/models';

/** Provider registered on the in-memory registry for this run. */
export const GATEWAY_PROVIDER = 'posthog-gateway';

/**
 * The gateway speaks two shapes on two endpoints: Anthropic models over
 * `anthropic-messages` (the SDK appends `/v1/messages`, so the base URL has no
 * `/v1`), and OpenAI-class models (`openai/gpt-5`, …) over OpenAI completions at
 * `/v1/chat/completions` (base URL keeps `/v1`). Infer the shape from the model
 * id so a pair's model selects the right transport.
 */
export function gatewayApiFor(
  modelId: string,
): 'anthropic-messages' | 'openai-completions' {
  return modelId.startsWith('openai/')
    ? 'openai-completions'
    : 'anthropic-messages';
}

/**
 * Gateway HTTP headers, mirroring `buildAgentEnv` on the anthropic path: always
 * the Bedrock-fallback header, plus wizard metadata (`X-POSTHOG-PROPERTY-*`) and
 * wizard feature flags (`X-POSTHOG-FLAG-*`).
 */
export function buildGatewayHeaders(
  wizardMetadata: Record<string, string>,
  wizardFlags: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    'x-posthog-use-bedrock-fallback': 'true',
    // 1M context window, same as the anthropic edition — pi otherwise runs at
    // 200k and overflows on larger projects (the post-run compaction failures).
    'anthropic-beta': 'context-1m-2025-08-07',
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

export interface GatewayProviderInputs {
  gatewayUrl: string;
  accessToken: string;
  wizardMetadata: Record<string, string>;
  wizardFlags: Record<string, string>;
  modelId: string;
  // Linear runs honour the wizard-pi-effort flag; orchestrator tasks pass false
  // so each per-agent model keeps its own tuned effort from the table.
  applyEffortFlag?: boolean;
  // Explicit per-agent effort from the prompt frontmatter — validated to a
  // ThinkingLevel at the parse boundary; overrides the table default for a
  // reasoning model when set.
  effort?: ThinkingLevel;
}

/**
 * The provider object for `registry.registerProvider(GATEWAY_PROVIDER, …)`,
 * plus the derived traits the session setup needs (`caps.thinkingLevel`,
 * `gatewayUrl` for triage auth).
 */
export function buildGatewayProvider(inputs: GatewayProviderInputs): {
  provider: Record<string, unknown>;
  api: 'anthropic-messages' | 'openai-completions';
  caps: ReturnType<typeof modelCapabilities>;
  gatewayUrl: string;
  baseUrl: string;
} {
  const {
    gatewayUrl,
    accessToken,
    wizardMetadata,
    wizardFlags,
    modelId,
    applyEffortFlag = true,
    effort,
  } = inputs;
  const api = gatewayApiFor(modelId);
  const tableCaps = modelCapabilities(modelId, wizardFlags, {
    applyEffortFlag,
  });
  // An explicit frontmatter effort wins over the table for a reasoning model.
  const caps =
    effort && tableCaps.reasoning
      ? { ...tableCaps, thinkingLevel: effort }
      : tableCaps;
  const baseUrl =
    api === 'openai-completions' ? `${gatewayUrl}/v1` : gatewayUrl;
  const provider = {
    name: 'PostHog Gateway',
    baseUrl,
    apiKey: accessToken,
    authHeader: true,
    api,
    headers: buildGatewayHeaders(wizardMetadata, wizardFlags),
    models: [
      {
        id: modelId,
        name: `${modelId} (PostHog Gateway)`,
        api,
        // Whether to request reasoning effort is a model trait resolved by
        // the switchboard, not a harness guess: non-reasoning openai models
        // reject `reasoning_effort` (gpt-4o → gateway UnsupportedParamsError
        // → the run no-ops). The effort level rides on the session.
        reasoning: caps.reasoning,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1_000_000,
        maxTokens: 64_000,
      },
    ],
  };
  return { provider, api, caps, gatewayUrl, baseUrl };
}
