/**
 * Revenue analytics wizard runner.
 *
 * Thin config wrapper around the generic skill bootstrap runner.
 * All revenue-specific logic (prerequisite detection, abort cases,
 * SDK lists, error types) lives in `workflows/revenue-analytics.ts`.
 */

import { runSkillBootstrap } from './skill-runner';
import { REVENUE_ABORT_CASES } from './workflows/revenue-analytics';
import type { WizardSession } from './wizard-session';

export async function runRevenueWizard(session: WizardSession): Promise<void> {
  await runSkillBootstrap(session, {
    skillId: 'revenue-analytics-setup',
    integrationLabel: 'revenue-analytics',
    promptContext: 'Set up revenue analytics for this project.',
    successMessage: 'Revenue analytics configured!',
    reportFile: 'posthog-revenue-report.md',
    docsUrl: 'https://posthog.com/docs/revenue-analytics',
    spinnerMessage: 'Setting up revenue analytics...',
    estimatedDurationMinutes: 5,
    abortCases: REVENUE_ABORT_CASES,
  });
}
