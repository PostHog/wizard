import { REVENUE_ANALYTICS_RUN } from './run.js';
import type { ProgramConfig } from '@programs/program-step';
import { WIZARD_TOOL_NAMES } from '@agent';
import { REVENUE_ANALYTICS_PROGRAM } from './steps.js';
import { detectRevenuePrerequisites } from './detect.js';

export const revenueAnalyticsConfig: ProgramConfig = {
  command: 'revenue-analytics',
  description: 'Set up PostHog for Revenue Analytics',
  id: 'revenue-analytics-setup',
  skillId: 'revenue-analytics-setup',
  steps: REVENUE_ANALYTICS_PROGRAM,
  onReady: (ctx) =>
    detectRevenuePrerequisites(ctx.session, ctx.setFrameworkContext),
  allowedTools: ['Agent'],
  disallowedTools: [WIZARD_TOOL_NAMES.wizardAsk],
  run: REVENUE_ANALYTICS_RUN,
  requires: ['posthog-integration'],
};

export { REVENUE_ANALYTICS_PROGRAM } from './steps.js';
export {
  detectRevenuePrerequisites,
  POSTHOG_SDKS,
  STRIPE_SDKS,
  type RevenueDetectError,
} from './detect.js';
