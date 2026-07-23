/** Basic-integration pi experiment: wizard-use-pi-harness (bool) → pi pinned to sol-medium, ONLY `posthog-integration`. */
import {
  GPT5_6_SOL_MODEL,
  WIZARD_USE_PI_HARNESS_FLAG_KEY,
} from '@lib/constants';
import type { HarnessExperiment } from './schemes';

export const BASIC_INTEGRATION_EXPERIMENT: HarnessExperiment = {
  program: 'posthog-integration',
  flags: {
    useFlag: WIZARD_USE_PI_HARNESS_FLAG_KEY,
    model: GPT5_6_SOL_MODEL,
    effort: 'medium',
  },
};
