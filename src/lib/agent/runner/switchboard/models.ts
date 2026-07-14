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
  WIZARD_PI_EFFORT_FLAG_KEY,
  WIZARD_USE_PI_HARNESS_FLAG_KEY,
} from '@lib/constants';
import { RUN_SURFACE } from '@env';

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
  // the openai-completions default (reasoning off). Luna stays low for cheap,
  // short-context mechanical work; terra runs medium as the sonnet-tier parallel
  // — enough reasoning depth for the judgment tasks without high's latency blowup.
  [GPT5_6_LUNA_MODEL]: { reasoning: true, thinkingLevel: 'low' },
  [GPT5_6_TERRA_MODEL]: { reasoning: true, thinkingLevel: 'medium' },
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

/** Capabilities for a gateway model id, table override then transport default. */
const EFFORT_FLAG_VARIANTS: readonly ThinkingLevel[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

export function modelCapabilities(
  modelId: string,
  flags: Record<string, string> = {},
  opts: { applyEffortFlag?: boolean } = {},
): ModelCapabilities {
  const caps = MODEL_CAPABILITIES[modelId] ?? defaultCaps(modelId);
  // The wizard-pi-effort override is a linear single-agent knob. Orchestrator
  // tasks carry their own per-agent model, so their effort comes from the table
  // (each agent's frontmatter model → its tuned level); they opt out here.
  if (opts.applyEffortFlag === false) return caps;
  // The wizard-pi-effort override applies only to a pi run — inert on the cloud surface or without the pi flag.
  if (
    RUN_SURFACE === 'cloud' ||
    flags[WIZARD_USE_PI_HARNESS_FLAG_KEY] !== 'true'
  )
    return caps;
  const effort = flags[WIZARD_PI_EFFORT_FLAG_KEY] as ThinkingLevel;
  if (caps.reasoning && EFFORT_FLAG_VARIANTS.includes(effort)) {
    return { ...caps, thinkingLevel: effort };
  }
  return caps;
}
