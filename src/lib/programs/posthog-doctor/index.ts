import type { ProgramConfig } from '../program-step.js';
import { POSTHOG_DOCTOR_PROGRAM } from './steps.js';

export const posthogDoctorConfig: ProgramConfig = {
  command: 'doctor',
  description:
    'Diagnose your PostHog project for configuration issues and setup warnings',
  id: 'posthog-doctor',
  steps: POSTHOG_DOCTOR_PROGRAM,
  allowedTools: ['Agent'],
};

export { POSTHOG_DOCTOR_PROGRAM } from './steps.js';
export { fetchHealthIssues } from './fetch.js';
export { getKindMeta, KIND_METADATA } from './kind-metadata.js';
export type { KindMeta } from './kind-metadata.js';
export type {
  HealthIssue,
  HealthIssueSeverity,
  HealthIssueSummary,
} from './types.js';
