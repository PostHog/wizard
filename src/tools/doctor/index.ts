/**
 * `wizard doctor`: the project's active health issues. Its screens live in
 * `src/tui/tools/doctor`; `report.ts` prints them for `--ci`.
 */

import type { ToolConfig } from '../types';

export const DOCTOR: ToolConfig = {
  id: 'posthog-doctor',
  command: 'doctor',
  description: 'Diagnose your PostHog project setup',
};

export { fetchHealthIssues } from './fetch';
export { getKindMeta } from './kind-metadata';
export type { HealthIssue, HealthIssueSeverity } from './types';
export { runDoctorReport } from './report';
