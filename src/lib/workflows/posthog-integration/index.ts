import type { WorkflowConfig } from '../workflow-step.js';
import { POSTHOG_INTEGRATION_WORKFLOW } from './steps.js';

export const posthogIntegrationConfig: WorkflowConfig = {
  description: 'Run the PostHog setup wizard',
  flowKey: 'core-integration',
  steps: POSTHOG_INTEGRATION_WORKFLOW,
};

export { POSTHOG_INTEGRATION_WORKFLOW } from './steps.js';
