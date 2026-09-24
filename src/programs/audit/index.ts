import {
  AGENT_SKILL_STEPS,
  createSkillProgram,
} from '@programs/agent-skill/index';
import type { ProgramStep, ProgramConfig } from '@programs/program-step';
import type { ProgramRun } from '@programs/program-run';
import { OutroKind } from '@agent';
import { WIZARD_TOOL_NAMES } from '@agent';
import {
  AUDIT_PROGRAM_OPTIONS,
  resolveAuditRunDefinition,
} from '@programs/resolve-run-definition';
import { AUDIT_CHECKS_FILE } from './types.js';

/** Audit-specific screens for the shared agent-skill pipeline. */
const AUDIT_SCREEN_BY_STEP: Record<string, string> = {
  intro: 'audit-intro',
  run: 'audit-run',
  outro: 'audit-outro',
};

type AuditRunState = {
  dashboardUrl: string | null;
  notebookUrl: string | null;
};

const withAuditScreens = (steps: ProgramStep[]): ProgramStep[] =>
  steps.map((step) => {
    const override = AUDIT_SCREEN_BY_STEP[step.id];
    return override ? { ...step, screenId: override } : step;
  });

const auditSteps: ProgramStep[] = withAuditScreens(AGENT_SKILL_STEPS);

const baseConfig = createSkillProgram(AUDIT_PROGRAM_OPTIONS);

const auditRun = (session: AuditRunState): Promise<ProgramRun> => {
  const baseRun = resolveAuditRunDefinition();

  return Promise.resolve({
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
};

export const auditConfig: ProgramConfig = {
  ...baseConfig,
  steps: auditSteps,
  run: auditRun,
  auditLedgerFile: AUDIT_CHECKS_FILE,
  // Ledger tools are opt-in per program; pi matches on the short name.
  allowedTools: [
    'Agent',
    WIZARD_TOOL_NAMES.auditSeedChecks,
    WIZARD_TOOL_NAMES.auditAddChecks,
    WIZARD_TOOL_NAMES.auditResolveChecks,
  ],
  disallowedTools: [WIZARD_TOOL_NAMES.wizardAsk],
};
