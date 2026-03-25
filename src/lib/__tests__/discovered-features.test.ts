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

  it('detects Sentry usage from known packages', () => {
    expect(discoverFeaturesFromDependencyNames(['@sentry/react'])).toContain(
      DiscoveredFeature.Sentry,
    );
  });

  it('detects LaunchDarkly usage from known packages', () => {
    expect(
      discoverFeaturesFromDependencyNames(['launchdarkly-react-client-sdk']),
    ).toContain(DiscoveredFeature.LaunchDarkly);
  });

  it('detects Braintrust usage from known packages', () => {
    expect(discoverFeaturesFromDependencyNames(['braintrust'])).toContain(
      DiscoveredFeature.Braintrust,
    );
  });

  it('returns multiple discovered features when multiple package families match', () => {
    expect(
      discoverFeaturesFromDependencyNames([
        'stripe',
        '@amplitude/analytics-node',
        '@anthropic-ai/sdk',
        '@sentry/nextjs',
        'launchdarkly-js-client-sdk',
        '@braintrust/core',
      ]),
    ).toEqual([
      DiscoveredFeature.Stripe,
      DiscoveredFeature.LLM,
      DiscoveredFeature.Amplitude,
      DiscoveredFeature.Sentry,
      DiscoveredFeature.LaunchDarkly,
      DiscoveredFeature.Braintrust,
    ]);
  });

  it('ignores unknown packages', () => {
    expect(discoverFeaturesFromDependencyNames(['left-pad'])).toEqual([]);
  });
});
