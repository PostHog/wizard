import fg from 'fast-glob';
import fs from 'fs';
import path from 'path';
import { AdditionalFeature, DiscoveredFeature } from './wizard-session.js';

const FEATURE_ORDER: DiscoveredFeature[] = [
  DiscoveredFeature.Stripe,
  DiscoveredFeature.LLM,
  DiscoveredFeature.Amplitude,
  DiscoveredFeature.Sentry,
  DiscoveredFeature.LaunchDarkly,
  DiscoveredFeature.Braintrust,
];

const STRIPE_PACKAGES = ['stripe', '@stripe/stripe-js'];

const LLM_PACKAGES = [
  'openai',
  '@anthropic-ai/sdk',
  'ai',
  '@ai-sdk/openai',
  'langchain',
  '@langchain/openai',
  '@langchain/langgraph',
  '@google/generative-ai',
  '@google/genai',
  '@instructor-ai/instructor',
  '@mastra/core',
  'portkey-ai',
];

const AMPLITUDE_PACKAGES = [
  'amplitude-js',
  'ampli',
  '@amplitude/analytics-browser',
  '@amplitude/analytics-node',
  '@amplitude/analytics-react-native',
  '@amplitude/plugin-autocapture-browser',
  '@amplitude/plugin-page-view-tracking-browser',
  '@amplitude/session-replay-browser',
  '@amplitude/experiment-js-client',
  '@amplitude/experiment-node-server',
  '@amplitude/unified',
  'amplitude-analytics',
  'amplitude-api',
  'amplitudeswift',
  'amplitude-swift',
  'amplitude-ios',
];

const SENTRY_PACKAGES = [
  '@sentry/browser',
  '@sentry/react',
  '@sentry/nextjs',
  '@sentry/node',
  '@sentry/vue',
  '@sentry/sveltekit',
  '@sentry/angular',
  '@sentry/react-native',
  '@sentry/capacitor',
  '@sentry/cloudflare',
  '@sentry/vercel-edge',
  '@sentry/astro',
  '@sentry/nuxt',
  'sentry-sdk',
  'sentry-ruby',
  'sentry-rails',
  'sentry-sidekiq',
  'sentry-delayed_job',
  'sentry-resque',
  'sentry/sentry',
  'sentry/sentry-laravel',
  'sentry/sentry-symfony',
];

const LAUNCHDARKLY_PACKAGES = [
  'launchdarkly-js-client-sdk',
  'launchdarkly-react-client-sdk',
  'launchdarkly-node-server-sdk',
  'launchdarkly-node-client-sdk',
  'launchdarkly-vue-client-sdk',
  '@launchdarkly/node-server-sdk',
  '@launchdarkly/js-server-sdk-common',
  'launchdarkly-server-sdk',
  'launchdarkly-react-native-client-sdk',
  'launchdarkly-api',
  'launchdarkly-observability',
  'launchdarkly/server-sdk',
  'launchdarkly/server-sdk-laravel',
];

const BRAINTRUST_PACKAGES = [
  'braintrust',
  '@braintrust/core',
  '@braintrust/proxy',
  '@braintrust/otel',
  'autoevals',
];

const FEATURE_PACKAGE_MAP: Array<{
  feature: DiscoveredFeature;
  packages: string[];
}> = [
  {
    feature: DiscoveredFeature.Stripe,
    packages: STRIPE_PACKAGES,
  },
  {
    feature: DiscoveredFeature.LLM,
    packages: LLM_PACKAGES,
  },
  {
    feature: DiscoveredFeature.Amplitude,
    packages: AMPLITUDE_PACKAGES,
  },
  {
    feature: DiscoveredFeature.Sentry,
    packages: SENTRY_PACKAGES,
  },
  {
    feature: DiscoveredFeature.LaunchDarkly,
    packages: LAUNCHDARKLY_PACKAGES,
  },
  {
    feature: DiscoveredFeature.Braintrust,
    packages: BRAINTRUST_PACKAGES,
  },
];

const FEATURE_CONTENT_MARKERS: Record<DiscoveredFeature, string[]> = {
  [DiscoveredFeature.Stripe]: ['@stripe/', 'stripe'],
  [DiscoveredFeature.LLM]: [
    'openai',
    'anthropic',
    '@ai-sdk/',
    'langchain',
    'portkey',
    'mastra',
  ],
  [DiscoveredFeature.Amplitude]: [
    '@amplitude/',
    'amplitude-analytics',
    'amplitude-api',
    'amplitude-swift',
    'amplitudeios',
    'com.amplitude:',
    'amplitude',
  ],
  [DiscoveredFeature.Sentry]: [
    '@sentry/',
    'sentry-sdk',
    'sentry-ruby',
    'sentry-rails',
    'sentry/sentry',
    'io.sentry:',
    'sentry-cocoa',
    'sentry',
  ],
  [DiscoveredFeature.LaunchDarkly]: [
    '@launchdarkly/',
    'launchdarkly',
    'com.launchdarkly:',
  ],
  [DiscoveredFeature.Braintrust]: ['@braintrust/', 'braintrust', 'autoevals'],
};

const FEATURE_DISCOVERY_PATTERNS = [
  '**/package.json',
  '**/composer.json',
  '**/Gemfile',
  '**/requirements*.txt',
  '**/requirements/**/*.txt',
  '**/pyproject.toml',
  '**/Pipfile',
  '**/Package.swift',
  '**/Podfile',
  '**/build.gradle',
  '**/build.gradle.kts',
  '**/gradle/libs.versions.toml',
];

const FEATURE_DISCOVERY_IGNORES = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/.venv/**',
  '**/venv/**',
  '**/__pycache__/**',
  '**/vendor/**',
  '**/Pods/**',
  '**/build/**',
];

export interface CompetitorMigrationOption {
  discoveredFeature: DiscoveredFeature;
  additionalFeature: AdditionalFeature;
  label: string;
  hint: string;
}

export const COMPETITOR_MIGRATION_OPTIONS: readonly CompetitorMigrationOption[] =
  [
    {
      discoveredFeature: DiscoveredFeature.Amplitude,
      additionalFeature: AdditionalFeature.AmplitudeMigration,
      label: 'Amplitude',
      hint: 'product analytics',
    },
    {
      discoveredFeature: DiscoveredFeature.Sentry,
      additionalFeature: AdditionalFeature.SentryMigration,
      label: 'Sentry',
      hint: 'error tracking',
    },
    {
      discoveredFeature: DiscoveredFeature.LaunchDarkly,
      additionalFeature: AdditionalFeature.LaunchDarklyMigration,
      label: 'LaunchDarkly',
      hint: 'feature flags',
    },
    {
      discoveredFeature: DiscoveredFeature.Braintrust,
      additionalFeature: AdditionalFeature.BraintrustMigration,
      label: 'Braintrust',
      hint: 'LLM analytics',
    },
  ];

function addDiscoveredFeatures(
  target: Set<DiscoveredFeature>,
  features: Iterable<DiscoveredFeature>,
): void {
  for (const feature of features) {
    target.add(feature);
  }
}

function discoverFeaturesFromContent(content: string): DiscoveredFeature[] {
  const normalized = content.toLowerCase();

  return FEATURE_ORDER.filter((feature) =>
    FEATURE_CONTENT_MARKERS[feature].some((marker) =>
      normalized.includes(marker),
    ),
  );
}

function getDependencyNamesFromManifest(manifestPath: string): string[] {
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
      optionalDependencies?: Record<string, unknown>;
      peerDependencies?: Record<string, unknown>;
      require?: Record<string, unknown>;
      'require-dev'?: Record<string, unknown>;
    };
    const filename = path.basename(manifestPath);

    if (filename === 'package.json') {
      return Object.keys({
        ...parsed.dependencies,
        ...parsed.devDependencies,
        ...parsed.optionalDependencies,
        ...parsed.peerDependencies,
      });
    }

    if (filename === 'composer.json') {
      return Object.keys({
        ...parsed.require,
        ...parsed['require-dev'],
      });
    }
  } catch {
    // Ignore parse failures — content scanning will still run for text manifests.
  }

  return [];
}

export function discoverFeaturesFromDependencyNames(
  depNames: string[],
): DiscoveredFeature[] {
  const normalized = depNames.map((dep) => dep.toLowerCase());

  return FEATURE_PACKAGE_MAP.filter(({ packages }) =>
    normalized.some((dep) => packages.includes(dep)),
  ).map(({ feature }) => feature);
}

export async function discoverFeaturesFromInstallDir(
  installDir: string,
): Promise<DiscoveredFeature[]> {
  const manifestPaths = await fg(FEATURE_DISCOVERY_PATTERNS, {
    cwd: installDir,
    absolute: true,
    onlyFiles: true,
    unique: true,
    ignore: FEATURE_DISCOVERY_IGNORES,
  });

  const discovered = new Set<DiscoveredFeature>();

  for (const manifestPath of manifestPaths) {
    const dependencyNames = getDependencyNamesFromManifest(manifestPath);
    if (dependencyNames.length > 0) {
      addDiscoveredFeatures(
        discovered,
        discoverFeaturesFromDependencyNames(dependencyNames),
      );
      continue;
    }

    try {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      addDiscoveredFeatures(discovered, discoverFeaturesFromContent(content));
    } catch {
      // Ignore unreadable files — discovery is best-effort.
    }
  }

  return FEATURE_ORDER.filter((feature) => discovered.has(feature));
}

export function getCompetitorMigrationOptions(
  discoveredFeatures: readonly DiscoveredFeature[],
): CompetitorMigrationOption[] {
  const discovered = new Set(discoveredFeatures);

  return COMPETITOR_MIGRATION_OPTIONS.filter((option) =>
    discovered.has(option.discoveredFeature),
  );
}
