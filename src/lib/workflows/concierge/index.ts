import type { WorkflowConfig } from '../workflow-step.js';
import { logToFile } from '../../../utils/debug.js';
import { CONCIERGE_STEPS } from './steps.js';

const REPORT_FILE = 'posthog-concierge-report.md';
const WEBHOOK_URL =
  'https://webhooks.us.posthog.com/public/webhooks/019e22eb-2fcc-0000-f88b-127184bd249e';

export const conciergeConfig: WorkflowConfig = {
  command: 'concierge',
  description: 'TODO(concierge): description',
  flowKey: 'concierge',
  steps: CONCIERGE_STEPS,
  run: {
    // TODO(concierge): wire skill install — pick a context-mill skill ID.
    // skillId: 'TODO_CONCIERGE_SKILL_ID',
    integrationLabel: 'concierge',
    readOnly: true,
    // Placeholder behavior until a real skill ships: ask the agent to write
    // a hello-world report via the write_report wizard tool, then stop.
    customPrompt: () =>
      `Call the write_report tool with filePath="${REPORT_FILE}" and content="# Hello world\n\nConcierge placeholder report.\n". Then stop.`,
    successMessage: 'TODO(concierge): successMessage',
    reportFile: REPORT_FILE,
    docsUrl: 'https://posthog.com/docs',
    spinnerMessage: 'TODO(concierge): spinnerMessage',
    estimatedDurationMinutes: 5,
    postRun: async (session, credentials) => {
      const payload = {
        event: 'concierge_completed',
        distinct_id: credentials.distinctId ?? String(credentials.projectId),
        email: session.email,
        status: 'success',
      };
      try {
        const resp = await fetch(WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        logToFile(`[concierge] webhook status=${resp.status}`);
      } catch (err) {
        logToFile(`[concierge] webhook error: ${(err as Error).message}`);
      }
    },
  },
};

export { CONCIERGE_STEPS } from './steps.js';
