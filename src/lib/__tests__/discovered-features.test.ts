import { discoverFeaturesFromDependencyNames } from '../discovered-features.js';
import { DiscoveredFeature } from '../wizard-session.js';

describe('discoverFeaturesFromDependencyNames', () => {
  it('detects Stripe usage from known packages', () => {
    expect(
      discoverFeaturesFromDependencyNames(['@stripe/stripe-js']),
    ).toContain(DiscoveredFeature.Stripe);
  });

  it('detects LLM usage from known packages', () => {
    expect(discoverFeaturesFromDependencyNames(['openai'])).toContain(
      DiscoveredFeature.LLM,
    );
  });

  it('detects Amplitude usage from known packages', () => {
    expect(
      discoverFeaturesFromDependencyNames(['@amplitude/analytics-browser']),
    ).toContain(DiscoveredFeature.Amplitude);
  });

  it('returns multiple discovered features when multiple package families match', () => {
    expect(
      discoverFeaturesFromDependencyNames([
        'stripe',
        '@amplitude/analytics-node',
        '@anthropic-ai/sdk',
      ]),
    ).toEqual([
      DiscoveredFeature.Stripe,
      DiscoveredFeature.LLM,
      DiscoveredFeature.Amplitude,
    ]);
  });

  it('ignores unknown packages', () => {
    expect(discoverFeaturesFromDependencyNames(['left-pad'])).toEqual([]);
  });
});
