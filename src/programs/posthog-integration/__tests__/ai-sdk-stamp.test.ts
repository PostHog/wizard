import { stampAiSdkDetected, type AiSdkStampEvidence } from '../ai-sdk-stamp';
import { analytics } from '@utils/analytics';
import { DiscoveredFeature } from '@shared/scan-consent';
import type { ApiUser } from '@shared/api';
import type { DetectedSource } from '@programs/warehouse-sources/types';

vi.mock('@utils/analytics', () => ({
  analytics: { groupIdentify: vi.fn() },
}));

const orgUser = { organization: { id: 'org-1' } } as Pick<
  ApiUser,
  'organization'
>;

const source = (kind: string): DetectedSource => ({
  kind,
  label: kind,
  mode: 'in-cli',
  matchedSignal: `dependency: ${kind}`,
});

function evidence(over: Partial<AiSdkStampEvidence> = {}): AiSdkStampEvidence {
  return {
    apiUser: orgUser,
    discoveredFeatures: [],
    warehouseSources: [],
    mayReportScanResults: true,
    ...over,
  };
}

describe('stampAiSdkDetected', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stamps the organization for an AI warehouse-source kind', () => {
    stampAiSdkDetected(evidence({ warehouseSources: [source('OpenAI')] }));

    expect(analytics.groupIdentify).toHaveBeenCalledExactlyOnceWith(
      'organization',
      'org-1',
      { wizard_ai_sdk_detected: true },
    );
  });

  it('stamps the organization for a discovered LLM feature', () => {
    stampAiSdkDetected(
      evidence({ discoveredFeatures: [DiscoveredFeature.LLM] }),
    );

    expect(analytics.groupIdentify).toHaveBeenCalledExactlyOnceWith(
      'organization',
      'org-1',
      { wizard_ai_sdk_detected: true },
    );
  });

  it.each([
    ['scan results may not be reported', { mayReportScanResults: false }],
    ['the organization is unknown', { apiUser: null }],
    ['only non-AI kinds were found', { warehouseSources: [source('Stripe')] }],
  ] as const)('does not stamp when %s', (_case, over) => {
    stampAiSdkDetected(
      evidence({ discoveredFeatures: [DiscoveredFeature.Stripe], ...over }),
    );

    expect(analytics.groupIdentify).not.toHaveBeenCalled();
  });
});
