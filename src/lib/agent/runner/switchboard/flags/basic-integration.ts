/**
 * Basic-integration pi experiment (`posthog-integration` program): the
 * shipped multivariate scheme — use + model + effort flags.
 */
import {
  GPT5_4_MODEL,
  WIZARD_PI_EFFORT_FLAG_KEY,
  WIZARD_PI_MODEL_FLAG_KEY,
  WIZARD_USE_PI_HARNESS_FLAG_KEY,
} from '@lib/constants';
import type { ConfigFlag } from './schemes';

export const BASIC_INTEGRATION_FLAGS: ConfigFlag = {
  useFlag: WIZARD_USE_PI_HARNESS_FLAG_KEY,
  modelFlag: WIZARD_PI_MODEL_FLAG_KEY,
  effortFlag: WIZARD_PI_EFFORT_FLAG_KEY,
  fallbackModel: GPT5_4_MODEL,
};
