/**
 * Self-driving pi experiment: boolean use flag whose `{model, effort}`
 * payload picks the variant; an invalid payload keeps the non-flagged
 * default.
 */
import { WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY } from '@lib/constants';
import type { ConfigFlag } from './schemes';

export const SELF_DRIVING_FLAGS: ConfigFlag = {
  useFlag: WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY,
};
