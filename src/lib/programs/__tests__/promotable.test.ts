import { getPromotableRecommendations } from '@lib/programs/promotable';
import { buildSession, DiscoveredFeature } from '@lib/wizard-session';
import { Program } from '@lib/programs/program-registry';

describe('getPromotableRecommendations', () => {
  it('returns no recommendations when nothing was detected', () => {
    const session = buildSession({ installDir: '/tmp/nope' });
    expect(getPromotableRecommendations(session)).toEqual([]);
  });

  it('recommends revenue analytics when Stripe is detected', () => {
    const session = buildSession({ installDir: '/tmp/nope' });
    session.discoveredFeatures = [DiscoveredFeature.Stripe];

    const ids = getPromotableRecommendations(session).map((c) => c.id);

    expect(ids).toContain(Program.RevenueAnalyticsSetup);
  });

  it('does not recommend a program whose feature was not detected', () => {
    const session = buildSession({ installDir: '/tmp/nope' });
    session.discoveredFeatures = [DiscoveredFeature.LLM];

    const ids = getPromotableRecommendations(session).map((c) => c.id);

    expect(ids).not.toContain(Program.RevenueAnalyticsSetup);
  });

  it('only ever returns programs that declared promotable metadata', () => {
    const session = buildSession({ installDir: '/tmp/nope' });
    session.discoveredFeatures = [
      DiscoveredFeature.Stripe,
      DiscoveredFeature.LLM,
    ];

    for (const config of getPromotableRecommendations(session)) {
      expect(config.promotable).toBeDefined();
    }
  });
});
