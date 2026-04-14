import type { WorkflowConfig } from '../workflow-step.js';
import { REVENUE_ANALYTICS_WORKFLOW } from './steps.js';

export const revenueAnalyticsConfig: WorkflowConfig = {
  command: 'revenue',
  description: 'Set up PostHog revenue analytics (e.g. Stripe integration)',
  flowKey: 'revenue-analytics',
  steps: REVENUE_ANALYTICS_WORKFLOW,
  run: {
    skillId: 'revenue-analytics-setup',
    integrationLabel: 'revenue-analytics',
    customPrompt: () => 'Set up revenue analytics for this project.',
    successMessage: 'Revenue analytics configured!',
    reportFile: 'posthog-revenue-report.md',
    docsUrl: 'https://posthog.com/docs/revenue-analytics',
    spinnerMessage: 'Setting up revenue analytics...',
    estimatedDurationMinutes: 5,
  },
  requires: ['posthog-integration'],
};

export { REVENUE_ANALYTICS_WORKFLOW } from './steps.js';
export {
  detectRevenuePrerequisites,
  POSTHOG_SDKS,
  STRIPE_SDKS,
  type RevenueDetectError,
} from './detect.js';
