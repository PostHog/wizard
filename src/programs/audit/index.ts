import {
  createSkillProgram,
  type SkillProgramOptions,
} from '@programs/agent-skill/index';
import type { ProgramConfig } from '@programs/program-step';
import type { ProgramRun } from '@programs/program-run';
import { OutroKind } from '@agent';
import { WIZARD_TOOL_NAMES } from '@agent';
import { skillRunDefinition } from '@programs/agent-skill/run-definition';
import { AUDIT_ABORT_CASES } from './detect.js';
import { AUDIT_CHECKS_FILE, AUDIT_REPORT_FILE } from './types.js';
import { AUDIT_SEED_CHECKS } from './seed.js';

type AuditRunState = {
  dashboardUrl: string | null;
  notebookUrl: string | null;
};

const AUDIT_OPTIONS: SkillProgramOptions = {
  skillId: 'audit',
  command: 'audit',
  id: 'audit',
  description: 'Audit and improve your PostHog setup',
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
};

const baseConfig = createSkillProgram(AUDIT_OPTIONS);
const baseRun = skillRunDefinition(AUDIT_OPTIONS);

const auditRun = (session: AuditRunState): Promise<ProgramRun> =>
  Promise.resolve({
    ...baseRun,
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
  });

export const auditConfig: ProgramConfig = {
  ...baseConfig,
  run: auditRun,
  auditLedgerFile: AUDIT_CHECKS_FILE,
  auditSeedChecks: AUDIT_SEED_CHECKS,
  // Ledger tools are opt-in per program; pi matches on the short name.
  allowedTools: [
    'Agent',
    WIZARD_TOOL_NAMES.auditSeedChecks,
    WIZARD_TOOL_NAMES.auditAddChecks,
    WIZARD_TOOL_NAMES.auditResolveChecks,
  ],
  disallowedTools: [WIZARD_TOOL_NAMES.wizardAsk],
};
