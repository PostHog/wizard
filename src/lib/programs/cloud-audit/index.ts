/**
 * The audit, run on the hosted agent platform.
 *
 * Behaviourally this is the same product as `audit`: same screens, same live
 * checklist, same report on disk. What differs is where the thinking happens —
 * a frozen bundle server-side rather than a local agent subprocess reaching for
 * a remote skill. That's what lets the audit's checklist and report format be
 * fixed by re-freezing the agent rather than shipping a wizard release.
 *
 * Reachable two ways: `wizard audit cloud` runs it explicitly, and the
 * `wizard-cloud-audit` flag routes plain `wizard audit` here (see audit/index.ts).
 */
import type { ProgramRun } from '@lib/agent/agent-runner';
import { AGENT_SKILL_STEPS } from '@lib/programs/agent-skill/index';
import { withAuditScreens } from '@lib/programs/audit/screens';
import type { ProgramConfig, ProgramStep } from '@lib/programs/program-step';
import { AUDIT_REPORT_FILE } from '@lib/programs/audit/types';
import { WIZARD_TOOL_NAMES } from '@lib/wizard-tools';
import type { WizardSession } from '@lib/wizard-session';
import { OutroKind } from '@lib/wizard-session';
import { getCloudUrlFromRegion } from '@utils/urls';

import { seedCloudAuditLedger } from './seed.js';

const DOCS_URL = 'https://posthog.com/docs/product-analytics/best-practices';

const SUCCESS_MESSAGE = `Audit complete! You can view the audit report at ./${AUDIT_REPORT_FILE}`;

/**
 * Build the cloud audit's run. Exported so the `audit` program can hand off to
 * it when the flag is on, without duplicating any of this.
 */
export function buildCloudAuditRun(session: WizardSession): ProgramRun {
  // Seed a placeholder so the run screen has something to render before the
  // agent's first resolve_checks lands. The real checklist arrives from the
  // agent's bundle — we deliberately don't keep a second copy of the catalog.
  seedCloudAuditLedger(session.installDir);

  return {
    executor: 'cloud',
    integrationLabel: 'cloud-audit',
    spinnerMessage: 'Auditing PostHog integration...',
    successMessage: SUCCESS_MESSAGE,
    errorMessage: 'Audit failed',
    estimatedDurationMinutes: 5,
    reportFile: AUDIT_REPORT_FILE,
    docsUrl: DOCS_URL,

    buildOutroData: (sess, _credentials, cloudRegion) => {
      const cloudUrl = cloudRegion
        ? getCloudUrlFromRegion(cloudRegion)
        : undefined;
      return {
        kind: OutroKind.Success as const,
        message: SUCCESS_MESSAGE,
        reportFile: AUDIT_REPORT_FILE,
        docsUrl: DOCS_URL,
        continueUrl:
          sess.signup && cloudUrl
            ? `${cloudUrl}/products?source=wizard`
            : undefined,
      };
    },
  };
}

const cloudAuditSteps: ProgramStep[] = withAuditScreens(AGENT_SKILL_STEPS);

export const cloudAuditConfig: ProgramConfig = {
  command: 'cloud',
  parentCommand: 'audit',
  id: 'cloud-audit',
  description:
    'Audit an existing PostHog integration using the hosted PostHog audit agent',
  steps: cloudAuditSteps,
  // Top-level reportFile so AuditRunScreen can resolve the report path without
  // unwrapping the deferred `run` (same reason as events-audit).
  reportFile: AUDIT_REPORT_FILE,
  requires: ['posthog-integration'],
  // No local agent runs, but the hosted one does — the AI opt-in gate still applies.
  requiresAi: true,
  disallowedTools: [WIZARD_TOOL_NAMES.wizardAsk],

  run: (session: WizardSession): Promise<ProgramRun> =>
    Promise.resolve(buildCloudAuditRun(session)),
};
