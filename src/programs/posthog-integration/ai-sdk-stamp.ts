/** The organization's wizard_ai_sdk_detected stamp, computed from explicit evidence. */

import type { ApiUser } from '@shared/api';
import { DiscoveredFeature } from '@shared/scan-consent';
import { analytics } from '@utils/analytics';
import { AI_SOURCE_KINDS } from '@programs/warehouse-sources/registry';
import type { DetectedSource } from '@programs/warehouse-sources/types';

export type AiSdkStampEvidence = {
  apiUser: Pick<ApiUser, 'organization'> | null;
  discoveredFeatures: readonly DiscoveredFeature[];
  warehouseSources: readonly DetectedSource[];
  /** Scan consent was granted, so local detection results may be reported. */
  mayReportScanResults: boolean;
};

function hasAiSdkEvidence(evidence: AiSdkStampEvidence): boolean {
  return (
    evidence.warehouseSources.some((s) => AI_SOURCE_KINDS.has(s.kind)) ||
    evidence.discoveredFeatures.includes(DiscoveredFeature.LLM)
  );
}

/**
 * Boolean only, on the org, never the list of kinds or any non-AI tool: a
 * decline must not leak even the shape of what local detection saw.
 */
export function stampAiSdkDetected(evidence: AiSdkStampEvidence): void {
  if (!evidence.mayReportScanResults) return;
  const organizationId = evidence.apiUser?.organization?.id;
  if (!organizationId) return;
  if (!hasAiSdkEvidence(evidence)) return;

  analytics.groupIdentify('organization', organizationId, {
    wizard_ai_sdk_detected: true,
  });
}
