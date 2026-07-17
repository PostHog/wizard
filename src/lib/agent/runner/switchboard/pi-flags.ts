/**
 * Per-program pi flag configs. A program listed here can be routed to the pi
 * harness by its own PostHog flag set; any program absent is untouched by the
 * pi experiment and keeps its binding default.
 *
 * Lives in its own leaf module (imports only constants + the ProgramId type)
 * because both `harness.ts` and `models.ts` read it — exporting it from
 * `harness.ts` would close an import cycle through the pi harness
 * (models → harness → harness/pi → models).
 */
import {
  GPT5_4_MODEL,
  GPT5_6_TERRA_MODEL,
  WIZARD_PI_EFFORT_FLAG_KEY,
  WIZARD_PI_MODEL_FLAG_KEY,
  WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY,
  WIZARD_USE_PI_HARNESS_FLAG_KEY,
} from '@lib/constants';
import type { ProgramId } from '@lib/programs/program-registry';

export interface PiFlagConfig {
  /** Boolean flag: 'true' → route this program to pi. */
  useFlag: string;
  /** Multivariate flag: variant key → gateway id via `PI_MODEL_FLAG_VARIANTS`. Absent → model comes from the useFlag's `{model, effort}` payload. */
  modelFlag?: string;
  /** Multivariate flag: reasoning-effort override (minimal/low/medium/high/xhigh). Absent → effort comes from the useFlag's payload. */
  effortFlag?: string;
  /** Model when the variant is missing or unknown. */
  fallbackModel: string;
}

/** Programs whose pi experiment is flag-driven; absent → the flags are a no-op. */
export const PI_FLAG_CONFIGS: Partial<Record<ProgramId, PiFlagConfig>> = {
  'posthog-integration': {
    useFlag: WIZARD_USE_PI_HARNESS_FLAG_KEY,
    modelFlag: WIZARD_PI_MODEL_FLAG_KEY,
    effortFlag: WIZARD_PI_EFFORT_FLAG_KEY,
    fallbackModel: GPT5_4_MODEL,
  },
  'self-driving': {
    useFlag: WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY,
    fallbackModel: GPT5_6_TERRA_MODEL,
  },
};
