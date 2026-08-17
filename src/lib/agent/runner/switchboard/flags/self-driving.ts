/**
 * Self-driving pi experiment.
 *
 * Flag:   wizard-self-driving-use-pi-harness (bool; payload `{model, effort?,
 *         harness?, sequence?}`)
 * Routes: ONLY `self-driving` — any axis the payload pins. A missing or
 *         invalid payload keeps the non-flagged binding default.
 */
import { WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY } from '@lib/constants';
import type { HarnessExperiment } from './schemes';

export const SELF_DRIVING_EXPERIMENT: HarnessExperiment = {
  program: 'self-driving',
  flags: {
    useFlag: WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY,
  },
};
