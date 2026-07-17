/**
 * Pi experiment flags — everything about how PostHog flags route a program to
 * the pi harness lives here: the flag vocabulary (model variant keys, effort
 * levels), the per-program configs, payload validation, and route resolution.
 * `harness.ts` only calls `resolvePiFlagRoute`, so the switchboard seam stays
 * clean. Leaf module: imports only constants, zod, and types.
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
  SONNET_5_MODEL,
  WIZARD_PI_EFFORT_FLAG_KEY,
  WIZARD_PI_MODEL_FLAG_KEY,
  WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY,
  WIZARD_USE_PI_HARNESS_FLAG_KEY,
} from '@lib/constants';
import type { ProgramId } from '@lib/programs/program-registry';
import { logToFile } from '@utils/debug';
import type { EffortLevel } from '../models';

// ── Shared vocabulary ─────────────────────────────────────────────────────

/** Model variant key → gateway id (variant keys can't carry `/` or `.`). */
const PI_MODEL_FLAG_VARIANTS: Record<string, string> = {
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

/** A resolved flag route: gateway model id + optional effort override. */
export interface PiFlagRoute {
  model: string;
  thinkingLevel?: EffortLevel;
}

// ── Config schemes ────────────────────────────────────────────────────────

/** Trio scheme: model/effort ride their own multivariate flags. */
interface PiFlagTrioConfig {
  /** Boolean flag: 'true' → route this program to pi. */
  useFlag: string;
  /** Multivariate flag: variant key → gateway id via `PI_MODEL_FLAG_VARIANTS`. */
  modelFlag: string;
  /** Multivariate flag: reasoning-effort override. */
  effortFlag: string;
  /** Model when the variant is missing or unknown. */
  fallbackModel: string;
}

/** Payload scheme: the useFlag's `{model, effort}` payload carries both; anything invalid keeps the non-flagged binding default. */
interface PiFlagPayloadConfig {
  useFlag: string;
  modelFlag?: never;
}

export type PiFlagConfig = PiFlagTrioConfig | PiFlagPayloadConfig;

/** `{model, effort}` payload shape; extra keys tolerated for forward compat. */
const piFlagPayloadSchema = z.object({
  model: z.string().refine((key) => key in PI_MODEL_FLAG_VARIANTS),
  effort: z.enum(EFFORT_FLAG_VARIANTS).optional(),
});

// ── Per-program configs ───────────────────────────────────────────────────

export const PI_FLAG_CONFIGS: Partial<Record<ProgramId, PiFlagConfig>> = {
  // ── posthog-integration: trio scheme (use + model + effort flags) ──
  'posthog-integration': {
    useFlag: WIZARD_USE_PI_HARNESS_FLAG_KEY,
    modelFlag: WIZARD_PI_MODEL_FLAG_KEY,
    effortFlag: WIZARD_PI_EFFORT_FLAG_KEY,
    fallbackModel: GPT5_4_MODEL,
  },
  // ── self-driving: payload scheme ({model, effort} on the use flag) ──
  'self-driving': {
    useFlag: WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY,
  },
};

// ── Resolution ────────────────────────────────────────────────────────────

/** Validate a payload (object or JSON string) into a route; undefined on any unexpected shape. */
function parsePiFlagPayload(raw: unknown): PiFlagRoute | undefined {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return undefined;
    }
  }
  const parsed = piFlagPayloadSchema.safeParse(value);
  if (!parsed.success) return undefined;
  return {
    model: PI_MODEL_FLAG_VARIANTS[parsed.data.model],
    thinkingLevel: parsed.data.effort,
  };
}

/**
 * The flag-driven pi route for a program, or undefined when the flags don't
 * validly route it: no config, use flag off, or a payload that fails
 * validation — the caller then keeps the non-flagged binding default.
 */
export function resolvePiFlagRoute(
  program: ProgramId,
  flags: Record<string, string>,
  flagPayloads?: Record<string, unknown>,
): PiFlagRoute | undefined {
  const cfg = PI_FLAG_CONFIGS[program];
  if (!cfg) return undefined;
  if (flags[cfg.useFlag] !== 'true') return undefined;
  if (cfg.modelFlag) {
    const effort = flags[cfg.effortFlag] as EffortLevel;
    return {
      model:
        PI_MODEL_FLAG_VARIANTS[flags[cfg.modelFlag] ?? ''] ?? cfg.fallbackModel,
      thinkingLevel: EFFORT_FLAG_VARIANTS.includes(effort) ? effort : undefined,
    };
  }
  const route = parsePiFlagPayload(flagPayloads?.[cfg.useFlag]);
  if (!route) {
    logToFile(
      `[switchboard] ${cfg.useFlag} on but payload missing/invalid — keeping the non-flagged default`,
    );
  }
  return route;
}
