import type { ProgramConfig } from '../program-step.js';
import { WIZARD_TOOL_NAMES } from '../../tools/index.js';
import { REVENUE_ANALYTICS_PROGRAM } from './steps.js';
import { REVENUE_ABORT_CASES } from './detect.js';

export const revenueAnalyticsConfig: ProgramConfig = {
  command: 'revenue-analytics',
  description: 'Set up PostHog for Revenue Analytics',
  id: 'revenue-analytics-setup',
  skillId: 'revenue-analytics-setup',
  steps: REVENUE_ANALYTICS_PROGRAM,
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
};

export { REVENUE_ANALYTICS_PROGRAM } from './steps.js';
export {
  detectRevenuePrerequisites,
  POSTHOG_SDKS,
  STRIPE_SDKS,
  type RevenueDetectError,
} from './detect.js';
