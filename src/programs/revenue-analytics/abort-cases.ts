import type { AbortCase } from '@agent/types';

/** `[ABORT] <reason>` cases the revenue analytics skill can emit. */
export const REVENUE_ABORT_CASES: AbortCase[] = [
  {
    // Skill emits: [ABORT] Could not find a PostHog distinct_id
    match: /^could not find a posthog distinct_id$/i,
    message: 'Could not find a PostHog distinct_id',
    body:
      'The agent could not find PostHog distinct_id usage in your codebase. ' +
      'Your users must be identified in PostHog before they can be tagged in Stripe. ' +
      'Please identify your users and try again.',
    docsUrl: 'https://posthog.com/docs/product-analytics/identify',
  },
  {
    // Skill emits: [ABORT] Could not find a Stripe integration
    match: /^could not find a stripe integration$/i,
    message: 'Could not find a Stripe integration',
    body:
      'The Wizard could not find an existing Stripe customer, charge, ' +
      'subscription, or other Stripe operations. Please run the Revenue ' +
      'Analytics Wizard on a project with an existing Stripe integration.',
    docsUrl: 'https://posthog.com/docs/revenue-analytics',
  },
];
