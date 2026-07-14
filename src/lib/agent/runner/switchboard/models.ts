/**
 * Model capabilities — the traits a harness needs that a bare gateway model id
 * doesn't carry. The switchboard resolves *which* model (harness.ts); this
 * resolves *what the model can do*, so a harness never hardcodes it.
 *
 * `reasoning` gates whether a harness requests reasoning at all; `thinkingLevel`
 * sets how much. Non-reasoning openai-completions models reject the reasoning
 * params (gpt-4o → gateway `UnsupportedParamsError` → the pi run no-ops), and
 * effort trades speed for depth (flagship gpt-5 at high effort runs long). Both
 * are silent when wrong, so they live here as one configurable table.
 */
import {
  DEFAULT_AGENT_MODEL,
  SONNET_5_MODEL,
  OPUS_MODEL,
  HAIKU_MODEL,
  GPT5_MODEL,
  GPT5_4_MODEL,
  GPT5_5_MODEL,
  GPT5_6_LUNA_MODEL,
  GPT5_6_SOL_MODEL,
  GPT5_6_TERRA_MODEL,
  GPT5_MINI_MODEL,
} from '@lib/constants';

/** Reasoning effort. pi maps it to `reasoning_effort` for openai-completions. */
export type ThinkingLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh';

export interface ModelCapabilities {
  /** Model supports reasoning; safe to request reasoning effort. */
  reasoning: boolean;
  /** Effort to request when reasoning. Omit for the harness/provider default. */
  thinkingLevel?: ThinkingLevel;
}

/** Explicit per-model traits. Anything absent falls back to `defaultCaps`. */
export const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  [DEFAULT_AGENT_MODEL]: { reasoning: true }, // claude-sonnet-4-6
  [SONNET_5_MODEL]: { reasoning: true },
  [OPUS_MODEL]: { reasoning: true },
  [HAIKU_MODEL]: { reasoning: true },
  // Flagship openai reasoning model at low effort: capable but kept fast, so a
  // run finishes in a few minutes instead of the long high-effort default.
  [GPT5_MODEL]: { reasoning: true, thinkingLevel: 'low' },
  [GPT5_4_MODEL]: { reasoning: true, thinkingLevel: 'low' },
  // Latest openai flagship line; all reasoning models, so they must opt in past
  // the openai-completions default (reasoning off). Low effort keeps a run fast.
  [GPT5_6_LUNA_MODEL]: { reasoning: true, thinkingLevel: 'low' },
  [GPT5_6_TERRA_MODEL]: { reasoning: true, thinkingLevel: 'low' },
  [GPT5_6_SOL_MODEL]: { reasoning: true, thinkingLevel: 'low' },
  [GPT5_5_MODEL]: { reasoning: true, thinkingLevel: 'low' },
  // The pi runner's paired model — a smaller openai reasoning model. Medium
  // effort: enough to follow the skill's setup completely, still fast.
  [GPT5_MINI_MODEL]: { reasoning: true, thinkingLevel: 'medium' },
  'openai/o4-mini': { reasoning: true },
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

/**
 * Capabilities for a gateway model id, table override then transport default.
 * `effortOverride` is a switchboard-resolved effort (e.g. from a pi effort
 * flag); it applies only when the model reasons at all — a non-reasoning model
 * rejects reasoning effort, so the override is dropped.
 */
export function modelCapabilities(
  modelId: string,
  effortOverride?: ThinkingLevel,
): ModelCapabilities {
  const caps = MODEL_CAPABILITIES[modelId] ?? defaultCaps(modelId);
  if (caps.reasoning && effortOverride) {
    return { ...caps, thinkingLevel: effortOverride };
  }
  return caps;
}
