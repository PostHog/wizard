import type { ProgramConfig } from '@lib/programs/program-step';
// Import from the leaf module (not @lib/wizard-session): this value is read at
// module-init, and the leaf is dependency-free so it can't be mid-cycle.
import { DiscoveredFeature } from '@lib/discovered-features';
import { WIZARD_TOOL_NAMES } from '@lib/wizard-tools';
import { REVENUE_ANALYTICS_PROGRAM } from './steps.js';
import { REVENUE_ABORT_CASES } from './detect.js';
import { getContentBlocks } from './content/index.js';

export const revenueAnalyticsConfig: ProgramConfig = {
  command: 'revenue',
  description: 'Set up PostHog revenue analytics (e.g. Stripe integration)',
  id: 'revenue-analytics-setup',
  steps: REVENUE_ANALYTICS_PROGRAM,
  getContentBlocks,
  allowedTools: ['Agent'],
  disallowedTools: [WIZARD_TOOL_NAMES.wizardAsk],
  run: {
    skillId: 'revenue-analytics-setup',
    integrationLabel: 'revenue-analytics-setup',
    customPrompt: () => 'Set up revenue analytics for this project.',
    successMessage: 'Revenue analytics configured!',
    reportFile: 'posthog-revenue-report.md',
    docsUrl: 'https://posthog.com/docs/revenue-analytics',
    spinnerMessage: 'Setting up revenue analytics...',
    estimatedDurationMinutes: 5,
    abortCases: REVENUE_ABORT_CASES,
  },
  requires: ['posthog-integration'],
  promotable: {
    feature: DiscoveredFeature.Stripe,
    label: 'Revenue analytics',
    description: 'connect Stripe to track revenue in PostHog',
  },
};

export { REVENUE_ANALYTICS_PROGRAM } from './steps.js';
export {
  detectRevenuePrerequisites,
  POSTHOG_SDKS,
  STRIPE_SDKS,
  type RevenueDetectError,
} from './detect.js';
