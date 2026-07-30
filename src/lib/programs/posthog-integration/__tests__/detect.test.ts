/**
 * Feature-discovery tagging in the core integration detect step.
 *
 * `discoveredFeatures` only ever gets populated here (self-driving's composed
 * run never calls this step), and it runs before auth — so tagging it here is
 * what lets a post-auth capture inherit a real value instead of a null.
 */

import { detectPostHogIntegration } from '@lib/programs/posthog-integration/detect';
import type { ProgramReadyContext } from '@lib/programs/program-step';
import { buildSession, DiscoveredFeature } from '@lib/wizard-session';
import { analytics } from '@utils/analytics';
import { discoverFeatures, detectFramework } from '@lib/detection/index';
import { detectWarehouseSources } from '@lib/warehouse-sources/detect';

vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    captureException: vi.fn(),
  },
}));

vi.mock('@lib/detection/index', () => ({
  detectFramework: vi.fn().mockResolvedValue(null),
  discoverFeatures: vi.fn().mockReturnValue([]),
  gatherFrameworkContext: vi.fn().mockResolvedValue({}),
  checkFrameworkVersion: vi.fn().mockResolvedValue({ supported: true }),
}));

vi.mock('@lib/warehouse-sources/detect', () => ({
  detectWarehouseSources: vi.fn().mockReturnValue([]),
}));

function buildCtx(): ProgramReadyContext {
  const session = buildSession({ installDir: '/tmp/app' });
  return {
    session,
    setFrameworkContext: (key, value) => {
      session.frameworkContext[key] = value;
    },
    setFrameworkConfig: vi.fn(),
    setDetectedFramework: vi.fn(),
    setSkillId: vi.fn(),
    setUnsupportedVersion: vi.fn(),
    addDiscoveredFeature: (feature) => {
      if (!session.discoveredFeatures.includes(feature)) {
        session.discoveredFeatures.push(feature);
      }
    },
    setDetectionComplete: vi.fn(),
  };
}

describe('detectPostHogIntegration — discovered_features tag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (detectFramework as Mock).mockResolvedValue(null);
    (detectWarehouseSources as Mock).mockReturnValue([]);
  });

  it('tags the joined feature list', async () => {
    (discoverFeatures as Mock).mockReturnValue([
      DiscoveredFeature.Stripe,
      DiscoveredFeature.LLM,
    ]);

    await detectPostHogIntegration(buildCtx());

    expect(analytics.setTag).toHaveBeenCalledWith(
      'discovered_features',
      'stripe,llm',
    );
  });

  it('tags an explicit empty string at zero — absence stays distinguishable from never-ran', async () => {
    (discoverFeatures as Mock).mockReturnValue([]);

    await detectPostHogIntegration(buildCtx());

    expect(analytics.setTag).toHaveBeenCalledWith('discovered_features', '');
  });
});
