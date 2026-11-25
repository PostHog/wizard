/** Products the run project's installed PostHog SDK is too old for, per the table in `@shared/sdk-features`. */

import { lt } from 'semver';
import type { ProgramSession } from '@programs/program-contract';
import {
  SDK_FEATURE_LABELS,
  SDK_FEATURE_MINIMUMS,
  SDK_PACKAGES,
  type PostHogSdk,
  type SdkFeature,
} from '@shared/sdk-features';
import { runProjectSdk } from './registry';

/** One product the installed SDK is below the minimum for, with what to tell the person. */
export type SdkFeatureGap = {
  feature: SdkFeature;
  sdk: PostHogSdk;
  version: string;
  minimum: string;
  message: string;
};

/** The `features` the run project's installed PostHog SDK is too old for. Empty while versioned SDK skills are off. */
export function sdkFeatureGaps(
  session: ProgramSession,
  features: readonly SdkFeature[],
): SdkFeatureGap[] {
  const gaps: SdkFeatureGap[] = [];
  for (const feature of features) {
    const minimums: { readonly [S in PostHogSdk]?: string } =
      SDK_FEATURE_MINIMUMS[feature];
    for (const [sdk, minimum] of Object.entries(minimums) as [
      PostHogSdk,
      string,
    ][]) {
      const version = runProjectSdk(session, sdk)?.version;
      if (!version || !lt(version, minimum)) continue;
      const pkg = SDK_PACKAGES[sdk];
      gaps.push({
        feature,
        sdk,
        version,
        minimum,
        message:
          `${SDK_FEATURE_LABELS[feature]} needs ${pkg} ${minimum} or later, and this project has ${version}. ` +
          `Upgrade ${pkg} to ${minimum} or later, then run the wizard again.`,
      });
    }
  }
  return gaps;
}
