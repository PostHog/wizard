/**
 * Revenue analytics wizard runner.
 *
 * Thin config wrapper around the generic skill bootstrap runner.
 * The revenue workflow's detect step has already verified prerequisites
 * (PostHog + Stripe); the bootstrap runner handles skill install + agent run.
 */

import { runSkillBootstrap } from './skill-runner';
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
  });
}
