/**
 * Review-model experiment — sol-medium vs terra-medium on the orchestrator's
 * review task.
 *
 * Flags:  wizard-use-pi-harness (bool) gates; wizard-pi-model picks the arm;
 *         wizard-pi-effort overrides effort.
 * Routes: ONLY the `review` role of `posthog-integration` — the one place a
 *         flag outranks prompt-frontmatter `model_pi` (§3.6 inverted for
 *         exactly this role). Fail closed: use flag off, missing variant, or
 *         any variant outside `arms` → undefined, frontmatter stays.
 */
import {
  GPT5_6_SOL_MODEL,
  GPT5_6_TERRA_MODEL,
  WIZARD_PI_EFFORT_FLAG_KEY,
  WIZARD_PI_MODEL_FLAG_KEY,
  WIZARD_USE_PI_HARNESS_FLAG_KEY,
} from '@lib/constants';
import type { ProgramId } from '@lib/programs/program-registry';
import type { EffortLevel } from '../models';
import { EFFORT_FLAG_VARIANTS } from './schemes';

export const REVIEW_MODEL_EXPERIMENT = {
  program: 'posthog-integration' satisfies ProgramId,
  role: 'review',
  useFlag: WIZARD_USE_PI_HARNESS_FLAG_KEY,
  modelFlag: WIZARD_PI_MODEL_FLAG_KEY,
  effortFlag: WIZARD_PI_EFFORT_FLAG_KEY,
  /** The experiment's arms; any other variant fails closed to frontmatter. */
  arms: {
    'gpt-5-6-sol': GPT5_6_SOL_MODEL,
    'gpt-5-6-terra': GPT5_6_TERRA_MODEL,
  } as Record<string, string | undefined>,
} as const;

/** The review task's experiment route, or undefined (frontmatter stays). */
export function reviewModelOverride(
  program: ProgramId,
  role: string,
  flags: Record<string, string> = {},
): { model: string; effort?: EffortLevel } | undefined {
  const exp = REVIEW_MODEL_EXPERIMENT;
  if (program !== exp.program || role !== exp.role) return undefined;
  if (flags[exp.useFlag] !== 'true') return undefined;
  const model = exp.arms[flags[exp.modelFlag] ?? ''];
  if (!model) return undefined;
  const effort = flags[exp.effortFlag] as EffortLevel;
  return {
    model,
    effort: EFFORT_FLAG_VARIANTS.includes(effort) ? effort : undefined,
  };
}
