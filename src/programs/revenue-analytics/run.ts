import type { ProgramRun } from '@programs/program-run';
import { REVENUE_ABORT_CASES } from './abort-cases.js';
export const REVENUE_ANALYTICS_RUN: ProgramRun = {
  skillId: 'revenue-analytics-setup',
  integrationLabel: 'revenue-analytics-setup',
  customPrompt: () => 'Set up revenue analytics for this project.',
  successMessage: 'Revenue analytics configured!',
  reportFile: 'posthog-revenue-report.md',
  docsUrl: 'https://posthog.com/docs/revenue-analytics',
  spinnerMessage: 'Setting up revenue analytics...',
  estimatedDurationMinutes: 5,
  abortCases: REVENUE_ABORT_CASES,
};
