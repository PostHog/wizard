import type { ProgramConfig } from '../program-step.js';
import type { ProgramRun } from '../../agent/agent-runner.js';
import type { WizardSession } from '../../wizard-session.js';
import { OutroKind } from '../../wizard-session.js';
import { SPINNER_MESSAGE } from '../../framework-config.js';
import { isUsingTypeScript } from '../../../utils/setup-utils.js';
import { getCloudUrlFromRegion } from '../../../utils/urls.js';
import { WIZARD_TOOL_NAMES } from '../../wizard-tools.js';
import { EVENTS_AUDIT_PROGRAM } from './steps.js';
import { AUDIT_CHECKS_KEY } from '../audit/types.js';
import { AUDIT_SEED_CHECKS, seedAuditLedger } from '../audit/seed.js';

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
    // before the agent emits its first check update.
    seedAuditLedger(session.installDir);
    session.frameworkContext[AUDIT_CHECKS_KEY] = AUDIT_SEED_CHECKS;

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

        return {
          kind: OutroKind.Success as const,
          message: 'Your events audit was successful',
          reportFile: SETUP_REPORT_FILE,
          changes: [],
          docsUrl: DOCS_URL,
          continueUrl,
          dashboardUrl,
        };
      },
    });
  },
};

export { EVENTS_AUDIT_PROGRAM } from './steps.js';
