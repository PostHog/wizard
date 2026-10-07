import { createSkillProgram } from '../shared/skill-program';
import type { ProgramConfig } from '../program-step';
import type { ProgramRun } from '../program-run';
import type { RunnerContext } from '../runner-context';
import type { ProgramSession } from '../program-session';
import { OutroKind } from '@shared/outro';
import { WIZARD_TOOL_NAMES } from '@agent';
import { headlessOption, regionOption } from '@shared/headless-mode';
import { AUDIT_ABORT_CASES } from './detect.js';
import {
  AUDIT_CHECKS_FILE,
  AUDIT_CHECKS_KEY,
  AUDIT_REPORT_FILE,
} from './types.js';
import { AUDIT_SEED_CHECKS, seedAuditLedger } from './seed.js';
import { config as eventsAudit } from './events/config.js';

const seedBeforeAuditRun = (session: ProgramSession): void => {
  seedAuditLedger(session.installDir);
  session.frameworkContext[AUDIT_CHECKS_KEY] = AUDIT_SEED_CHECKS;
};

const baseConfig = createSkillProgram({
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
});

const auditRun = async (
  session: ProgramSession,
  runner: RunnerContext,
): Promise<ProgramRun> => {
  seedBeforeAuditRun(session);

  if (!baseConfig.run) {
    throw new Error('Audit program has no run configuration.');
  }

  const baseRun =
    typeof baseConfig.run === 'function'
      ? await baseConfig.run(session, runner)
      : baseConfig.run;

  return {
    ...baseRun,
    // Override the default outro so the dashboard + notebook URLs the
    // agent emits via `[DASHBOARD_URL]` / `[NOTEBOOK_URL]` are surfaced
    // on the post-run screen.
    buildOutroData: (sess, credentials) => {
      const cloudUrl = credentials.host.appHost;
      const continueUrl = sess.signup
        ? `${cloudUrl}/products?source=wizard`
        : undefined;

      // The session store lays any URL the agent emitted during the run over
      // this outro, so dashboardUrl/notebookUrl may stay undefined here.
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

const audit: ProgramConfig = {
  ...baseConfig,
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
  // The experimental headless flag — declared on `audit` (and basic
  // integration) rather than globally. mergeCommandOptions lands it on the
  // `wizard audit` command; dispatchProgram routes it to runWizardHeadless.
  cliOptions: { ...headlessOption, ...regionOption },
};

/** Registers `audit` and `events-audit`, which has no entry of its own. */
export const configs = [
  audit,
  eventsAudit,
] as const satisfies readonly ProgramConfig[];

export {
  AUDIT_CHECKS_FILE,
  AUDIT_CHECKS_KEY,
  AUDIT_REPORT_FILE,
  getAuditChecks,
  type AuditCheck,
  type AuditStatus,
} from './types.js';
export {
  removeAuditLedger,
  startAuditLedgerWatcher,
} from './ledger-watcher.js';
/** The checks every audit run starts from. */
export { AUDIT_SEED_CHECKS } from './seed.js';
