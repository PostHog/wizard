import type { WorkflowConfig } from '../workflow-step.js';
import type { WorkflowRun } from '../../agent/agent-runner.js';
import type { WizardSession } from '../../wizard-session.js';
import { OutroKind } from '../../wizard-session.js';
import { SPINNER_MESSAGE } from '../../framework-config.js';
import { isUsingTypeScript } from '../../../utils/setup-utils.js';
import { getCloudUrlFromRegion } from '../../../utils/urls.js';
import { EVENTS_AUDIT_WORKFLOW } from './steps.js';
import { getContentBlocks } from './content/content-blocks.js';

export const SETUP_REPORT_FILE = 'posthog-events-audit-report.md';

const DOCS_URL = 'https://posthog.com/docs/product-analytics/best-practices';

export const eventsAuditConfig: WorkflowConfig = {
  command: 'events-audit',
  description: 'Audit PostHog event tracking in this project',
  flowKey: 'events-audit',
  skillId: 'events-audit',
  steps: EVENTS_AUDIT_WORKFLOW,
  getContentBlocks,

  run: (session: WizardSession): Promise<WorkflowRun> => {
    const typeScriptDetected = isUsingTypeScript({
      installDir: session.installDir,
    });
    session.typescript = typeScriptDetected;

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

export { EVENTS_AUDIT_WORKFLOW } from './steps.js';
