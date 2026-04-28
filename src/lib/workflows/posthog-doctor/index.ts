import type { WorkflowConfig } from '../workflow-step.js';
import { POSTHOG_DOCTOR_WORKFLOW } from './steps.js';

export const posthogDoctorConfig: WorkflowConfig = {
  command: 'doctor',
  description:
    'Diagnose your PostHog project for configuration issues and setup warnings',
  flowKey: 'posthog-doctor',
  steps: POSTHOG_DOCTOR_WORKFLOW,
};

export { POSTHOG_DOCTOR_WORKFLOW } from './steps.js';
export { fetchHealthIssues } from './fetch.js';
export { getKindMeta, KIND_METADATA } from './kind-metadata.js';
export type { KindMeta } from './kind-metadata.js';
export type {
  HealthIssue,
  HealthIssueSeverity,
  HealthIssueSummary,
} from './types.js';
