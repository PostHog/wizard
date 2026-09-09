// Local capabilities inform transport parameters; gateway policy independently admits models and efforts.
import {
  SONNET_5_MODEL,
  HAIKU_MODEL,
  GPT5_6_LUNA_MODEL,
  GPT5_6_SOL_MODEL,
  GPT5_6_TERRA_MODEL,
  HAIKU_TRIAGE_MODEL,
  Harness,
} from '@lib/constants';

/** Reasoning effort, mapped by each harness to its provider transport. */
const THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** Whether a value (e.g. remote prompt frontmatter) names a valid effort. */
export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return (THINKING_LEVELS as readonly unknown[]).includes(value);
}

/**
 * An effort *override* is always a positive level — `'off'` is a model trait
 * (`reasoning: false`), not something a flag may force onto a reasoning model.
 */
export type EffortLevel = Exclude<ThinkingLevel, 'off'>;

export interface ModelCapabilities {
  /** Model supports reasoning; safe to request reasoning effort. */
  reasoning: boolean;
  /** Effort to request when reasoning. Omit for the harness/provider default. */
  thinkingLevel?: ThinkingLevel;
}

/** Explicit per-model traits. Anything absent falls back to `defaultCaps`. */
export const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  [SONNET_5_MODEL]: { reasoning: true },
  [HAIKU_MODEL]: { reasoning: true },
  // The openai 5.6 line; all reasoning models, so they must opt in past the
  // openai-completions default (reasoning off). Luna stays low for cheap,
  // short-context mechanical work; terra runs medium as the sonnet-tier parallel
  // — enough reasoning depth for the judgment tasks without high's latency blowup.
  [GPT5_6_LUNA_MODEL]: { reasoning: true, thinkingLevel: 'low' },
  [GPT5_6_TERRA_MODEL]: { reasoning: true, thinkingLevel: 'medium' },
  [GPT5_6_SOL_MODEL]: { reasoning: true, thinkingLevel: 'low' },
};

// Local model choices; gateway admission also requires allowed models, efforts, and prompt compatibility.
export const VALID_MODELS: ReadonlySet<string> = new Set(
  Object.keys(MODEL_CAPABILITIES),
);

/** Whether the value is an allow-listed model. */
export function isValidModel(model: unknown): model is string {
  return typeof model === 'string' && VALID_MODELS.has(model);
}

/** First allow-listed candidate, else throw so a bad id fails loud. */
export function requireKnownModel(
  ...candidates: (string | undefined)[]
): string {
  for (const c of candidates) if (isValidModel(c)) return c;
  throw new Error(
    `No valid model to dispatch on (tried ${JSON.stringify(candidates)}). ` +
      `Allowed: ${[...VALID_MODELS].join(', ')}.`,
  );
}

// Unknown Anthropic models default to reasoning; OpenAI models must opt in through the local table.
function defaultCaps(modelId: string): ModelCapabilities {
  return { reasoning: !modelId.startsWith('openai/') };
}

// Triage requests must satisfy gateway safety policy and preserve Warlock’s classifier format.
export const TRIAGE_MODELS: Record<Harness, string> = {
  [Harness.anthropic]: HAIKU_TRIAGE_MODEL,
  [Harness.pi]: GPT5_6_LUNA_MODEL,
};

export function triageModelFor(harness: Harness): string {
  return TRIAGE_MODELS[harness];
}

/**
 * Capabilities for a gateway model id, table override then transport default.
 * `effortOverride` is a switchboard-resolved effort (e.g. from a pi effort
 * flag); it applies only when the model reasons at all — a non-reasoning model
 * rejects reasoning effort, so the override is dropped.
 */
export function modelCapabilities(
  modelId: string,
  effortOverride?: EffortLevel,
): ModelCapabilities {
  const caps = MODEL_CAPABILITIES[modelId] ?? defaultCaps(modelId);
  if (caps.reasoning && effortOverride) {
    return { ...caps, thinkingLevel: effortOverride };
  }
  return caps;
}
