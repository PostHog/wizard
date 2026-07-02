/**
 * Model capabilities — the traits a harness needs that a bare gateway model id
 * doesn't carry. The switchboard resolves *which* model (harness.ts); this
 * resolves *what the model can do*, so a harness never hardcodes it.
 *
 * `reasoning` gates whether a harness requests reasoning/extended-thinking.
 * Non-reasoning openai-completions models reject the `reasoning_effort` param
 * (gpt-4o → gateway `UnsupportedParamsError` → the pi run no-ops). Getting this
 * wrong is silent, so it lives here as one configurable table, not per harness.
 */
import {
  DEFAULT_AGENT_MODEL,
  OPUS_MODEL,
  HAIKU_MODEL,
  GPT5_MODEL,
} from '@lib/constants';

export interface ModelCapabilities {
  /** Model supports reasoning; safe to request reasoning effort. */
  reasoning: boolean;
}

/** Explicit per-model traits. Anything absent falls back to `defaultCaps`. */
export const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  [DEFAULT_AGENT_MODEL]: { reasoning: true }, // claude-sonnet-4-6
  [OPUS_MODEL]: { reasoning: true },
  [HAIKU_MODEL]: { reasoning: true },
  [GPT5_MODEL]: { reasoning: true }, // openai reasoning model
};

/**
 * Default for a model not in the table: reasoning on for anthropic-messages
 * models, off for openai-completions — the non-reasoning openai models reject
 * reasoning effort, so off is the safe default (a reasoning openai model opts
 * back in via the table above). Transport is inferred the same way the pi
 * harness infers it (`openai/` prefix → openai-completions).
 */
function defaultCaps(modelId: string): ModelCapabilities {
  return { reasoning: !modelId.startsWith('openai/') };
}

/** Capabilities for a gateway model id, table override then transport default. */
export function modelCapabilities(modelId: string): ModelCapabilities {
  return MODEL_CAPABILITIES[modelId] ?? defaultCaps(modelId);
}
