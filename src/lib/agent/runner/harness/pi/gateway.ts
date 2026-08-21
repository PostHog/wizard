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
  buildWizardPropertiesBlob,
  type GatewayEdition,
} from '@lib/gateway-session';
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
 * Gateway HTTP headers, mirroring `buildAgentEnv` on the anthropic path. The
 * shape follows the gateway edition: legacy sends per-key metadata/flag
 * headers plus the explicit Bedrock-fallback opt-in; v2 (the Go ai-gateway)
 * takes one `X-PostHog-Properties` JSON blob and falls back natively. The 1M
 * context beta rides both — pi otherwise runs at 200k and overflows on larger
 * projects (the post-run compaction failures).
 */
export function buildGatewayHeaders(
  wizardMetadata: Record<string, string>,
  wizardFlags: Record<string, string>,
  edition: GatewayEdition = 'legacy',
  teamId?: number,
): Record<string, string> {
  const headers: Record<string, string> = {
    'anthropic-beta': 'context-1m-2025-08-07',
  };
  if (edition === 'v2') {
    headers['X-PostHog-Properties'] = buildWizardPropertiesBlob(
      wizardMetadata,
      wizardFlags,
      teamId,
    );
    return headers;
  }
  headers['x-posthog-use-bedrock-fallback'] = 'true';
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
  /** Gateway contract in play; selects the header shape. Default legacy. */
  edition?: GatewayEdition;
  /** Customer team for the v2 properties blob (from the mint response). */
  teamId?: number;
  wizardMetadata: Record<string, string>;
  wizardFlags: Record<string, string>;
  modelId: string;
  // Resolved effort override — the switchboard's flag/payload pick on linear
  // runs, the prompt-frontmatter effort on per-task agents. Overrides the
  // table default for a reasoning model when set.
  effort?: ThinkingLevel;
}

/**
 * One gateway model spec — the single description of how to reach a model on
 * the gateway. The provider spec below wraps it for pi's registry; one-shot
 * callers (scan triage) hand it straight to `completeSimple`.
 */
export function buildGatewayModel(inputs: GatewayProviderInputs) {
  const { gatewayUrl, wizardMetadata, wizardFlags, modelId, edition, teamId } =
    inputs;
  const api = gatewayApiFor(modelId);
  return {
    id: modelId,
    name: `${modelId} (PostHog Gateway)`,
    api,
    provider: GATEWAY_PROVIDER,
    // openai-completions keeps /v1; the SDK appends the route either way.
    baseUrl: api === 'openai-completions' ? `${gatewayUrl}/v1` : gatewayUrl,
    // A model trait resolved by the switchboard, not a harness guess:
    // non-reasoning openai models reject `reasoning_effort` (gpt-4o → gateway
    // UnsupportedParamsError → the run no-ops).
    reasoning: modelCapabilities(modelId).reasoning,
    input: ['text' as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    headers: buildGatewayHeaders(wizardMetadata, wizardFlags, edition, teamId),
  };
}

/**
 * The provider object for `registry.registerProvider(GATEWAY_PROVIDER, …)`,
 * plus the derived traits the session setup needs (`caps.thinkingLevel`).
 */
export function buildGatewayProvider(inputs: GatewayProviderInputs): {
  provider: Record<string, unknown>;
  api: 'anthropic-messages' | 'openai-completions';
  caps: ReturnType<typeof modelCapabilities>;
  gatewayUrl: string;
  baseUrl: string;
} {
  const { gatewayUrl, accessToken, modelId, effort } = inputs;
  const api = gatewayApiFor(modelId);
  const tableCaps = modelCapabilities(modelId);
  // An explicit effort override wins over the table for a reasoning model.
  const caps =
    effort && tableCaps.reasoning
      ? { ...tableCaps, thinkingLevel: effort }
      : tableCaps;
  const model = buildGatewayModel(inputs);
  const provider = {
    name: 'PostHog Gateway',
    baseUrl: model.baseUrl,
    apiKey: accessToken,
    authHeader: true,
    api,
    headers: model.headers,
    models: [model],
  };
  return { provider, api, caps, gatewayUrl, baseUrl: model.baseUrl };
}
