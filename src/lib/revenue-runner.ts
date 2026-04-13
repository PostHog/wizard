/**
 * Revenue analytics wizard runner.
 *
 * The detect workflow step has already verified prerequisites (PostHog + Stripe)
 * and downloaded the skill. This runner reads the skill path from the session
 * and hands off to the generic skill bootstrap runner.
 */

import { runSkillBootstrap } from './skill-runner';
import type { WizardSession } from './wizard-session';

export async function runRevenueWizard(session: WizardSession): Promise<void> {
  const skillPath = session.frameworkContext.skillPath as string;

  await runSkillBootstrap(session, {
    skillPath,
    integrationLabel: 'revenue-analytics',
    promptContext: 'Set up revenue analytics for this project.',
    successMessage: 'Revenue analytics configured!',
    reportFile: 'posthog-revenue-report.md',
    docsUrl: 'https://posthog.com/docs/revenue-analytics',
    spinnerMessage: 'Setting up revenue analytics...',
    estimatedDurationMinutes: 5,
  });
}
