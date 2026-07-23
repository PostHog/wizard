/**
 * Basic-integration pi experiment.
 *
 * Flags:  wizard-use-pi-harness (bool) + wizard-pi-model + wizard-pi-effort
 * Routes: ONLY `posthog-integration` — harness, model, and effort axes.
 */
import {
  GPT5_6_TERRA_MODEL,
  WIZARD_PI_EFFORT_FLAG_KEY,
  WIZARD_PI_MODEL_FLAG_KEY,
  WIZARD_USE_PI_HARNESS_FLAG_KEY,
} from '@lib/constants';
import type { HarnessExperiment } from './schemes';

export const BASIC_INTEGRATION_EXPERIMENT: HarnessExperiment = {
  program: 'posthog-integration',
  flags: {
    useFlag: WIZARD_USE_PI_HARNESS_FLAG_KEY,
    modelFlag: WIZARD_PI_MODEL_FLAG_KEY,
    effortFlag: WIZARD_PI_EFFORT_FLAG_KEY,
    // Where an unknown model variant lands.
    fallbackModel: GPT5_6_TERRA_MODEL,
  },
};
