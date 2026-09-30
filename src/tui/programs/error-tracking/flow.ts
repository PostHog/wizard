import type { ProgramStep } from '@programs/program-step';

/**
 * After login, the scan lists the repo's projects and the user picks one, as in
 * the legacy upload-source-maps program. The pick sets the framework preflight
 * resolves task skills against, and the project path the run is scoped to.
 */
export const PICK_PROJECT_STEP: ProgramStep = {
  id: 'detect',
  label: 'Detecting projects',
  screenId: 'error-tracking-detect',
  isComplete: (session) => session.integration != null,
};
