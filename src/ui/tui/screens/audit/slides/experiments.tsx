import type { AreaSlide } from './shared.js';

export const ExperimentsSlide: AreaSlide = {
  area: 'Experiments',
  intro: [
    "We're checking that exposure events fire when users see an experiment variant, and that variant assignment stays stable across a user's sessions.",
    "Without reliable exposures or stable assignments, experiment results drift and you can't trust the lift numbers.",
  ],
  docsUrl: 'https://posthog.com/docs/experiments',
};
