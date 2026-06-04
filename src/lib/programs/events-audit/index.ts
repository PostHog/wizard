import type { ProgramConfig } from '@lib/programs/program-step';
import type { ProgramRun } from '@lib/agent/agent-runner';
import type { WizardSession } from '@lib/wizard-session';
import { OutroKind } from '@lib/wizard-session';
import { SPINNER_MESSAGE } from '@lib/framework-config';
import { isUsingTypeScript } from '@utils/setup-utils';
import { getCloudUrlFromRegion } from '@utils/urls';
import { WIZARD_TOOL_NAMES } from '@lib/wizard-tools';
import { EVENTS_AUDIT_PROGRAM } from './steps.js';
import { AUDIT_CHECKS_KEY } from '@lib/programs/audit/types';
import { seedAuditLedger } from '@lib/programs/audit/seed';
import { EVENTS_AUDIT_SEED_CHECKS } from './seed.js';

export const SETUP_REPORT_FILE = 'posthog-events-audit-report.md';

const DOCS_URL = 'https://posthog.com/docs/product-analytics/best-practices';

export const eventsAuditConfig: ProgramConfig = {
  command: 'events-audit',
  description: 'Audit PostHog event tracking in this project',
  id: 'events-audit',
  skillId: 'events-audit',
  steps: EVENTS_AUDIT_PROGRAM,
  // Top-level reportFile so AuditRunScreen can resolve the report path
  // synchronously without unwrapping the deferred `run` function.
  reportFile: SETUP_REPORT_FILE,
  allowedTools: ['Agent'],
  disallowedTools: [WIZARD_TOOL_NAMES.wizardAsk],

  run: (session: WizardSession): Promise<ProgramRun> => {
    const typeScriptDetected = isUsingTypeScript({
      installDir: session.installDir,
    });
    session.typescript = typeScriptDetected;

    // Seed the audit ledger so AuditRunScreen has something to render
    // before the agent emits its first check update. The events-audit
    // ledger is the 6-phase pipeline, not the doctor's 10 integrity checks.
    seedAuditLedger(session.installDir, EVENTS_AUDIT_SEED_CHECKS);
    session.frameworkContext[AUDIT_CHECKS_KEY] = EVENTS_AUDIT_SEED_CHECKS;

    return Promise.resolve({
      skillId: 'events-audit',
      integrationLabel: 'events-audit',
      spinnerMessage: SPINNER_MESSAGE,
      successMessage:
        'Events audit complete! You can view the report at ./posthog-events-audit-report.md',
      estimatedDurationMinutes: 5,
      reportFile: SETUP_REPORT_FILE,
      docsUrl: DOCS_URL,
      errorMessage: 'Events audit failed',
      additionalFeatureQueue: session.additionalFeatureQueue,

      customPrompt: (ctx) =>
        `Audit PostHog event capture in this project. Do not modify any project files — produce a read-only report only.

Project context:
- PostHog Project ID: ${ctx.projectId}
- TypeScript: ${typeScriptDetected ? 'Yes' : 'No'}
- PostHog public token: ${ctx.projectApiKey}
- PostHog Host: ${ctx.host}
`,

      buildOutroData: (sess, _credentials, cloudRegion) => {
        const cloudUrl = cloudRegion
          ? getCloudUrlFromRegion(cloudRegion)
          : undefined;
        const continueUrl =
          sess.signup && cloudUrl
            ? `${cloudUrl}/products?source=wizard`
            : undefined;
        // The agent emits `[DASHBOARD_URL] <url>` once it creates the
        // dashboard; the SDK-message interceptor stores it on the session.
        // Fall back to the dashboards index if nothing was emitted.
        const dashboardUrl =
          sess.dashboardUrl ?? (cloudUrl ? `${cloudUrl}/dashboard` : undefined);

        // The agent emits `[NOTEBOOK_URL] <url>` once it uploads the report
        // to a PostHog notebook. No fallback: if the notebook upload was
        // skipped (e.g. MCP unavailable) we just don't show a link.
        const notebookUrl = sess.notebookUrl ?? undefined;

        return {
          kind: OutroKind.Success as const,
          message: 'Your events audit was successful',
          reportFile: SETUP_REPORT_FILE,
          changes: [],
          docsUrl: DOCS_URL,
          continueUrl,
          dashboardUrl,
          notebookUrl,
        };
      },
    });
  },
};

export { EVENTS_AUDIT_PROGRAM } from './steps.js';
