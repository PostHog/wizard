import type { ProgramConfig } from '@programs/program-step';
import { WIZARD_TOOL_NAMES } from '@agent';

export const posthogDoctorConfig: ProgramConfig = {
  command: 'doctor',
  description: 'Diagnose your PostHog project setup',
  id: 'posthog-doctor',
  requiresAi: false,
  allowedTools: ['Agent'],
  disallowedTools: [WIZARD_TOOL_NAMES.wizardAsk],
};

export { fetchHealthIssues } from './fetch.js';
export { getKindMeta, KIND_METADATA } from './kind-metadata.js';
export type { KindMeta } from './kind-metadata.js';
export type {
  HealthIssue,
  HealthIssueSeverity,
  HealthIssueSummary,
} from './types.js';
