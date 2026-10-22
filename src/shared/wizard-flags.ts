/** The wizard's feature flags as one snapshot, for a run's routing and prompts. */
import { analytics } from '@utils/analytics';

/** Feature flags and their payloads from one evaluation. */
export type WizardFlagSnapshot = {
  flags: Record<string, string>; // flag key to variant
  payloads: Record<string, unknown>; // flag key to payload
};

export async function loadWizardFlags(): Promise<WizardFlagSnapshot> {
  return {
    flags: await analytics.getAllFlagsForWizard(),
    payloads: analytics.getWizardFlagPayloads(),
  };
}
