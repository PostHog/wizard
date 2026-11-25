/** Products the run project's PostHog SDK is too old for, read against `SDK_FEATURE_MINIMUMS`. */

import { lt } from 'semver';
import type { ProgramSession, SdkFeature } from '@programs/program-contract';
import { declaredSdks } from './registry';
import { SDK_FEATURE_MINIMUMS } from './sdks';

export type SdkFeatureGap = {
  feature: SdkFeature;
  sdk: string;
  version: string;
  minimum: string;
  /** What the person upgrades, and to which version, before running the wizard again. */
  message: string;
};

/** One gap per product in `features` the run project's PostHog SDK is below the minimum for. */
export function sdkFeatureGaps(
  session: ProgramSession,
  features: readonly SdkFeature[],
): SdkFeatureGap[] {
  const sdks = declaredSdks(session);
  return features.flatMap((feature) => {
    const { label, minimums } = SDK_FEATURE_MINIMUMS[feature];
    return sdks.flatMap(({ name, version }) => {
      const minimum = minimums[name];
      if (!minimum || !lt(version, minimum)) return [];
      return [
        {
          feature,
          sdk: name,
          version,
          minimum,
          message: `${label} needs ${name} ${minimum} or later, and this project has ${version}. Upgrade ${name} to ${minimum} or later, then run the wizard again.`,
        },
      ];
    });
  });
}
