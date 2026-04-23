import type { WorkflowConfig } from '../workflow-step.js';
import { POSTHOG_HEALTH_WORKFLOW } from './steps.js';

export const posthogHealthConfig: WorkflowConfig = {
  command: 'health',
  description:
    'Check your PostHog project for configuration issues and health warnings',
  flowKey: 'posthog-health',
  steps: POSTHOG_HEALTH_WORKFLOW,
};

export { POSTHOG_HEALTH_WORKFLOW } from './steps.js';
export { fetchHealthIssues } from './fetch.js';
export { getKindMeta, KIND_METADATA } from './kind-metadata.js';
export type { KindMeta } from './kind-metadata.js';
export type {
  HealthIssue,
  HealthIssueSeverity,
  HealthIssueSummary,
} from './types.js';
