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
];

export function discoverFeaturesFromDependencyNames(
  depNames: string[],
): DiscoveredFeature[] {
  return FEATURE_PACKAGE_MAP.filter(({ packages }) =>
    depNames.some((dep) => packages.includes(dep)),
  ).map(({ feature }) => feature);
}
