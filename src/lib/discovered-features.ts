import { DiscoveredFeature } from './wizard-session.js';

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
];

const LAUNCHDARKLY_PACKAGES = [
  'launchdarkly-js-client-sdk',
  'launchdarkly-react-client-sdk',
  'launchdarkly-node-server-sdk',
  'launchdarkly-node-client-sdk',
  'launchdarkly-vue-client-sdk',
  '@launchdarkly/node-server-sdk',
  '@launchdarkly/js-server-sdk-common',
];

const BRAINTRUST_PACKAGES = [
  'braintrust',
  '@braintrust/core',
  '@braintrust/proxy',
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

export function discoverFeaturesFromDependencyNames(
  depNames: string[],
): DiscoveredFeature[] {
  return FEATURE_PACKAGE_MAP.filter(({ packages }) =>
    depNames.some((dep) => packages.includes(dep)),
  ).map(({ feature }) => feature);
}
