import {
  AGENT_SKILL_STEPS,
  createSkillProgram,
} from '@lib/programs/agent-skill/index';
import type { ProgramStep, ProgramConfig } from '@lib/programs/program-step';
import type { ProgramRun } from '@lib/agent/agent-runner';
import { isCloudAuditEnabled } from '@lib/agent/agent-interface';
import { buildCloudAuditRun } from '@lib/programs/cloud-audit/index';
import type { WizardSession } from '@lib/wizard-session';
import { OutroKind } from '@lib/wizard-session';
import { WIZARD_TOOL_NAMES } from '@lib/wizard-tools';
import { analytics } from '@utils/analytics';
import { getCloudUrlFromRegion } from '@utils/urls';
import { withAuditScreens } from './screens.js';
import { AUDIT_ABORT_CASES } from './detect.js';
import { AUDIT_CHECKS_KEY, AUDIT_REPORT_FILE } from './types.js';
import { AUDIT_SEED_CHECKS, seedAuditLedger } from './seed.js';

const seedBeforeAuditRun = (session: WizardSession): void => {
  seedAuditLedger(session.installDir);
  session.frameworkContext[AUDIT_CHECKS_KEY] = AUDIT_SEED_CHECKS;
};

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

/**
 * The classic local audit run: a Claude Agent SDK subprocess driving the `audit`
 * skill. Seeds the ledger as a side effect, so it's a resolver, not a value.
 * Used directly when the cloud flag is off, and as the cloud arm's fallback.
 */
const buildClassicAuditRun = async (
  session: WizardSession,
): Promise<ProgramRun> => {
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
    // Override the default outro so the dashboard + notebook URLs the
    // agent emits via `[DASHBOARD_URL]` / `[NOTEBOOK_URL]` are surfaced
    // on the post-run screen.
    buildOutroData: (sess, _credentials, cloudRegion) => {
      const cloudUrl = cloudRegion
        ? getCloudUrlFromRegion(cloudRegion)
        : undefined;
      const continueUrl =
        sess.signup && cloudUrl
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
        dashboardUrl: sess.dashboardUrl ?? undefined,
        notebookUrl: sess.notebookUrl ?? undefined,
      };
    },
  };
};

const auditRun = async (session: WizardSession): Promise<ProgramRun> => {
  // The cloud audit is the same product run a different way, so it forks here
  // rather than as a separate command — `wizard audit` is the only entry users
  // know, and this keeps the two arms A/B-comparable on identical screens.
  // (`wizard audit cloud` reaches the cloud arm directly, flag or no flag.)
  const flags = await analytics.getAllFlagsForWizard();
  if (isCloudAuditEnabled(flags)) {
    // Attach the classic run as the fallback: any cloud failure silently
    // lands the user on the local audit, on the same bootstrap. The cloud
    // arm seeds its own placeholder ledger; the fallback reseeds the classic
    // checklist when it runs.
    return { ...buildCloudAuditRun(session), fallback: buildClassicAuditRun };
  }

  return buildClassicAuditRun(session);
};

export const auditConfig: ProgramConfig = {
  ...baseConfig,
  steps: auditSteps,
  run: auditRun,
  allowedTools: ['Agent'],
  disallowedTools: [WIZARD_TOOL_NAMES.wizardAsk],
};
