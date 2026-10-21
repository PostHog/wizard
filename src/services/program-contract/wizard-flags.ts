/** The wizard's feature flags as one snapshot, for a run's routing and prompts. */
import { analytics } from '@utils/analytics';
import type { WizardFlagSnapshot } from './program-input';

export async function loadWizardFlags(): Promise<WizardFlagSnapshot> {
  return {
    flags: await analytics.getAllFlagsForWizard(),
    payloads: analytics.getWizardFlagPayloads(),
  };
}
