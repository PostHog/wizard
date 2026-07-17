/**
 * Flag config schemes — the shapes a PostHog flag set can take to route a
 * program to the pi harness, plus the shared vocabulary and the per-config
 * resolution. Experiment modules in this folder declare *which* flags they
 * use; this module owns *how* a config resolves to a route.
 */
import { z } from 'zod';
import {
  DEFAULT_AGENT_MODEL,
  GPT5_4_MODEL,
  GPT5_5_MODEL,
  GPT5_6_LUNA_MODEL,
  GPT5_6_SOL_MODEL,
  GPT5_6_TERRA_MODEL,
  GPT5_MINI_MODEL,
  GPT5_MODEL,
  Harness,
  Sequence,
  SONNET_5_MODEL,
} from '@lib/constants';
import { logToFile } from '@utils/debug';
import type { EffortLevel } from '../models';

// ── Shared vocabulary ─────────────────────────────────────────────────────

/** Model variant key → gateway id (variant keys can't carry `/` or `.`). */
const MODEL_FLAG_VARIANTS: Record<string, string> = {
  'gpt-5': GPT5_MODEL,
  'gpt-5-4': GPT5_4_MODEL,
  'gpt-5-mini': GPT5_MINI_MODEL,
  'gpt-5-5': GPT5_5_MODEL,
  'gpt-5-6-luna': GPT5_6_LUNA_MODEL,
  'gpt-5-6-terra': GPT5_6_TERRA_MODEL,
  'gpt-5-6-sol': GPT5_6_SOL_MODEL,
  'sonnet-4-6': DEFAULT_AGENT_MODEL,
  'sonnet-5': SONNET_5_MODEL,
};

/** Valid effort variants; anything else leaves the model's table default. */
const EFFORT_FLAG_VARIANTS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly EffortLevel[];

/** A resolved flag route. Absent fields keep the axis's default (pi harness, sequence resolved by its own chain, table effort). */
export interface FlagRoute {
  model: string;
  thinkingLevel?: EffortLevel;
  harness?: Harness;
  sequence?: Sequence;
}

// ── Config schemes ────────────────────────────────────────────────────────

/** Multivariate scheme: model/effort ride their own multivariate flags. */
export interface MultivariateConfigFlag {
  /** Boolean flag: 'true' → route this program to pi. */
  useFlag: string;
  /** Multivariate flag: variant key → gateway id via `MODEL_FLAG_VARIANTS`. */
  modelFlag: string;
  /** Multivariate flag: reasoning-effort override. */
  effortFlag: string;
  /** Model when the variant is missing or unknown. */
  fallbackModel: string;
}

/** Boolean-flag scheme: the useFlag's zod-validated `{model, effort}` payload carries both; anything invalid keeps the non-flagged binding default. */
export interface PayloadConfigFlag {
  useFlag: string;
  modelFlag?: never;
}

export type ConfigFlag = MultivariateConfigFlag | PayloadConfigFlag;

/** `{model, effort?, harness?, sequence?}` payload shape; extra keys tolerated for forward compat. */
const payloadConfigFlagSchema = z.object({
  model: z.string().refine((key) => key in MODEL_FLAG_VARIANTS),
  effort: z.enum(EFFORT_FLAG_VARIANTS).optional(),
  harness: z.nativeEnum(Harness).optional(),
  sequence: z.nativeEnum(Sequence).optional(),
});

// ── Resolution ────────────────────────────────────────────────────────────

/** Validate a payload (object or JSON string) into a route; undefined on any unexpected shape. */
function parseFlagPayload(raw: unknown): FlagRoute | undefined {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return undefined;
    }
  }
  const parsed = payloadConfigFlagSchema.safeParse(value);
  if (!parsed.success) return undefined;
  return {
    model: MODEL_FLAG_VARIANTS[parsed.data.model],
    thinkingLevel: parsed.data.effort,
    harness: parsed.data.harness,
    sequence: parsed.data.sequence,
  };
}

/**
 * Resolve one config against the flag snapshot, or undefined when it doesn't
 * validly route: use flag off, or a payload that fails validation — the
 * caller then keeps the non-flagged binding default.
 */
export function routeFromConfigFlag(
  cfg: ConfigFlag,
  flags: Record<string, string>,
  flagPayloads?: Record<string, unknown>,
): FlagRoute | undefined {
  if (flags[cfg.useFlag] !== 'true') return undefined;
  if (cfg.modelFlag) {
    const effort = flags[cfg.effortFlag] as EffortLevel;
    return {
      model:
        MODEL_FLAG_VARIANTS[flags[cfg.modelFlag] ?? ''] ?? cfg.fallbackModel,
      thinkingLevel: EFFORT_FLAG_VARIANTS.includes(effort) ? effort : undefined,
    };
  }
  const route = parseFlagPayload(flagPayloads?.[cfg.useFlag]);
  if (!route) {
    logToFile(
      `[switchboard] ${cfg.useFlag} on but payload missing/invalid — keeping the non-flagged default`,
    );
  }
  return route;
}
