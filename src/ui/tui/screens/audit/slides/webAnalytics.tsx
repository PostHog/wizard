import type { AreaSlide } from './shared.js';

export const WebAnalyticsSlide: AreaSlide = {
  area: 'Web Analytics',
  intro: [
    "We're checking how your browser SDK is configured for web analytics — reverse proxy coverage, authorized URLs, pageleave tracking, web vitals, and canonical URL handling.",
    'Misconfigurations here usually show up later as inflated session counts, missing exits, or duplicate pageviews across hosts.',
  ],
  docsUrl: 'https://posthog.com/docs/web-analytics',
};
