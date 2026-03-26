import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  discoverFeaturesFromDependencyNames,
  discoverFeaturesFromInstallDir,
  getCompetitorMigrationOptions,
} from '../discovered-features.js';
import { AdditionalFeature, DiscoveredFeature } from '../wizard-session.js';

describe('discoverFeaturesFromDependencyNames', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  function createTempDir(): string {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'posthog-wizard-features-'),
    );
    tempDirs.push(dir);
    return dir;
  }

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

  it('discovers competitor SDKs from non-Node manifests', async () => {
    const dir = createTempDir();

    fs.writeFileSync(path.join(dir, 'Gemfile'), "gem 'sentry-ruby'\n");
    fs.writeFileSync(
      path.join(dir, 'requirements.txt'),
      'launchdarkly-server-sdk==9.0.0\nbraintrust==0.1.0\n',
    );
    fs.mkdirSync(path.join(dir, 'android', 'app'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'android', 'app', 'build.gradle.kts'),
      'implementation("com.amplitude:analytics-android:1.0.0")\n',
    );

    await expect(discoverFeaturesFromInstallDir(dir)).resolves.toEqual([
      DiscoveredFeature.Amplitude,
      DiscoveredFeature.Sentry,
      DiscoveredFeature.LaunchDarkly,
      DiscoveredFeature.Braintrust,
    ]);
  });

  it('maps discovered competitor SDKs to migration options in display order', () => {
    expect(
      getCompetitorMigrationOptions([
        DiscoveredFeature.Braintrust,
        DiscoveredFeature.Sentry,
      ]).map((option) => option.additionalFeature),
    ).toEqual([
      AdditionalFeature.SentryMigration,
      AdditionalFeature.BraintrustMigration,
    ]);
  });
});
