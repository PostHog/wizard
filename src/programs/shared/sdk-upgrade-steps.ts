import type { ProgramSession, SdkFeature } from '@programs/program-contract';
import { sdkFeatureGaps } from '@services/project-discovery';

/** The outro's next steps for the products a too-old PostHog SDK kept out of this run. */
export function sdkUpgradeNextSteps(
  session: ProgramSession,
  features: readonly SdkFeature[],
): { heading: string; items: string[] } | undefined {
  const items = sdkFeatureGaps(session, features).map((gap) => gap.message);
  return items.length > 0
    ? { heading: 'Skipped until you upgrade the PostHog SDK:', items }
    : undefined;
}
