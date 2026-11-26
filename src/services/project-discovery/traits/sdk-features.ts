/** Products the run project's PostHog SDK is too old for, read against `SDK_FEATURE_MINIMUMS`. */

import { intersects, lt } from 'semver';
import type { ProgramSession, SdkFeature } from '@programs/program-contract';
import { declaredSdks } from './registry';
import { SDK_FEATURE_MINIMUMS } from './sdks';

export type SdkFeatureGap = {
  feature: SdkFeature;
  sdk: string;
  version: string;
  minimum: string;
  /** True when the declared range cannot satisfy `minimum` without a wider/major upgrade. */
  blocking: boolean;
  /** What the person upgrades, and to which version, before running the wizard again. */
  message: string;
};

/** One gap per product in `features` whose minimum is above the run project's declared SDK floor. */
export function sdkFeatureGaps(
  session: ProgramSession,
  features: readonly SdkFeature[],
): SdkFeatureGap[] {
  const sdks = declaredSdks(session);
  return features.flatMap((feature) => {
    const { label, minimums } = SDK_FEATURE_MINIMUMS[feature];
    return sdks.flatMap(({ ecosystem, name, version, range }) => {
      const minimum = minimums[`${ecosystem}:${name.toLowerCase()}`];
      if (!minimum || !lt(version, minimum)) return [];
      const blocking = !intersects(range, `>=${minimum}`);
      return [
        {
          feature,
          sdk: name,
          version,
          minimum,
          blocking,
          message: `${label} needs ${name} ${minimum} or later, and this project has ${version}. Upgrade ${name} to ${minimum} or later, then run the wizard again.`,
        },
      ];
    });
  });
}
