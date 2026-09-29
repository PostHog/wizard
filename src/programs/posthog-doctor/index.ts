import type { ProgramConfig } from '@programs/program-step';
import { WIZARD_TOOL_NAMES } from '@agent';
import { POSTHOG_DOCTOR_PROGRAM } from './steps.js';

export const posthogDoctorConfig: ProgramConfig = {
  command: 'doctor',
  description: 'Diagnose your PostHog project setup',
  id: 'posthog-doctor',
  requiresAi: false,
  steps: POSTHOG_DOCTOR_PROGRAM,
  allowedTools: ['Agent'],
  disallowedTools: [WIZARD_TOOL_NAMES.wizardAsk],
};

export { POSTHOG_DOCTOR_PROGRAM } from './steps.js';
export { fetchHealthIssues } from '../../tools/doctor/fetch.js';
export {
  getKindMeta,
  KIND_METADATA,
} from '../../tools/doctor/kind-metadata.js';
export type { KindMeta } from '../../tools/doctor/kind-metadata.js';
export type {
  HealthIssue,
  HealthIssueSeverity,
  HealthIssueSummary,
} from '../../tools/doctor/types.js';
