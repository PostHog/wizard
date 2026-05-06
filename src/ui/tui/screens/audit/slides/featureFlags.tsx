import type { AreaSlide } from './shared.js';

export const FeatureFlagsSlide: AreaSlide = {
  area: 'Feature Flags',
  intro: [
    "We're checking how your app evaluates feature flags — that flags are evaluated after PostHog initializes, and that bootstrap is configured for SSR or SPA setups.",
    'Flags evaluated too early or without bootstrap can cause flicker, flash-of-wrong-content, and inconsistent rollout coverage.',
  ],
  docsUrl: 'https://posthog.com/docs/feature-flags',
};
