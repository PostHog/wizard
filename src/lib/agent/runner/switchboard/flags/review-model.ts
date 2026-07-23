/** Review-model experiment: wizard-pi-model routes sol|terra (effort from wizard-pi-effort, else frontmatter) for posthog-integration's review role only — outranks prompt frontmatter there, fails closed everywhere else. */
import {
  WIZARD_PI_EFFORT_FLAG_KEY,
  WIZARD_PI_MODEL_FLAG_KEY,
  WIZARD_USE_PI_HARNESS_FLAG_KEY,
} from '@lib/constants';
import type { RoleExperiment } from './schemes';

export const REVIEW_MODEL_EXPERIMENT: RoleExperiment = {
  program: 'posthog-integration',
  role: 'review',
  useFlag: WIZARD_USE_PI_HARNESS_FLAG_KEY,
  modelFlag: WIZARD_PI_MODEL_FLAG_KEY,
  effortFlag: WIZARD_PI_EFFORT_FLAG_KEY,
  arms: ['gpt-5-6-sol', 'gpt-5-6-terra'],
};
