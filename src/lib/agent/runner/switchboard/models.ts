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
  OPUS_MODEL,
  HAIKU_MODEL,
  GPT5_MODEL,
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
  [OPUS_MODEL]: { reasoning: true },
  [HAIKU_MODEL]: { reasoning: true },
  // Flagship openai reasoning model at low effort: capable but kept fast, so a
  // run finishes in a few minutes instead of the long high-effort default.
  [GPT5_MODEL]: { reasoning: true, thinkingLevel: 'low' },
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

/** Capabilities for a gateway model id, table override then transport default. */
export function modelCapabilities(modelId: string): ModelCapabilities {
  return MODEL_CAPABILITIES[modelId] ?? defaultCaps(modelId);
}
