/**
 * Basic-integration pi experiment.
 *
 * Flag:   wizard-use-pi-harness (bool) → pi on sol-medium, pinned.
 * Routes: ONLY `posthog-integration` — harness, model, and effort axes.
 *         wizard-pi-model / wizard-pi-effort are NOT read here; they belong
 *         to the review-model experiment (`review-model.ts`).
 */
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
