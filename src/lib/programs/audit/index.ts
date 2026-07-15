import {
  AGENT_SKILL_STEPS,
  createSkillProgram,
} from '@lib/programs/agent-skill/index';
import type { ProgramStep, ProgramConfig } from '@lib/programs/program-step';
import type { ProgramRun } from '@lib/agent/agent-runner';
import type { WizardSession } from '@lib/wizard-session';
import { OutroKind } from '@lib/wizard-session';
import { WIZARD_TOOL_NAMES } from '@lib/wizard-tools';
import { AUDIT_ABORT_CASES } from './detect.js';
import { AUDIT_CHECKS_KEY, AUDIT_REPORT_FILE } from './types.js';
import { AUDIT_SEED_CHECKS, seedAuditLedger } from './seed.js';
import { uploadSetupReview } from './setup-review.js';

/** Audit-specific screens for the shared agent-skill pipeline. */
const AUDIT_SCREEN_BY_STEP: Record<string, string> = {
  intro: 'audit-intro',
  run: 'audit-run',
  outro: 'audit-outro',
};

const seedBeforeAuditRun = (session: WizardSession): void => {
  seedAuditLedger(session.installDir);
  session.frameworkContext[AUDIT_CHECKS_KEY] = AUDIT_SEED_CHECKS;
};

const withAuditScreens = (steps: ProgramStep[]): ProgramStep[] =>
  steps.map((step) => {
    const override = AUDIT_SCREEN_BY_STEP[step.id];
    return override ? { ...step, screenId: override } : step;
  });

const auditSteps: ProgramStep[] = withAuditScreens(AGENT_SKILL_STEPS);

const baseConfig = createSkillProgram({
  skillId: 'audit',
  command: 'audit',
  id: 'audit',
  description:
    'Audit an existing PostHog integration for correctness and best practices',
  integrationLabel: 'audit',
  customPrompt:
    'Run a comprehensive audit of the existing PostHog integration. Follow the skill program steps in order. Do not modify any project files — only create the final audit report.',
  successMessage:
    'Audit complete! You can view the audit report at ./posthog-audit-report.md',
  reportFile: AUDIT_REPORT_FILE,
  docsUrl: 'https://posthog.com/docs/product-analytics/best-practices',
  spinnerMessage: 'Auditing PostHog integration...',
  estimatedDurationMinutes: 5,
  requires: ['posthog-integration'],
  abortCases: AUDIT_ABORT_CASES,
});

const auditRun = async (session: WizardSession): Promise<ProgramRun> => {
  seedBeforeAuditRun(session);

  if (!baseConfig.run) {
    throw new Error('Audit program has no run configuration.');
  }

  const baseRun =
    typeof baseConfig.run === 'function'
      ? await baseConfig.run(session)
      : baseConfig.run;

  return {
    ...baseRun,
    // Hand the finished ledger to the signals setup review (fail-silent,
    // interactive runs only — see setup-review.ts for the why).
    postRun: uploadSetupReview,
    // Override the default outro so the dashboard + notebook URLs the
    // agent emits via `[DASHBOARD_URL]` / `[NOTEBOOK_URL]` are surfaced
    // on the post-run screen.
    buildOutroData: (sess, credentials) => {
      const cloudUrl = credentials.host.appHost;
      const continueUrl = sess.signup
        ? `${cloudUrl}/products?source=wizard`
        : undefined;

      // Note: `sess` here is the agent-runner's snapshot of session at
      // runAgent() invocation time. Any URL emissions during the run land
      // on the live store, NOT on this snapshot. The UI layer
      // (InkUI.setOutroData) merges live URLs in on top of this return
      // value, so it's safe to leave dashboardUrl/notebookUrl as undefined
      // here when the snapshot doesn't have them.
      return {
        kind: OutroKind.Success as const,
        message: baseRun.successMessage,
        reportFile: baseRun.reportFile,
        docsUrl: baseRun.docsUrl,
        continueUrl,
        dashboardUrl: session.dashboardUrl ?? undefined,
        notebookUrl: session.notebookUrl ?? undefined,
      };
    },
  };
};

export const auditConfig: ProgramConfig = {
  ...baseConfig,
  steps: auditSteps,
  run: auditRun,
  allowedTools: ['Agent'],
  disallowedTools: [WIZARD_TOOL_NAMES.wizardAsk],
};
