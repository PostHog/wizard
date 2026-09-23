import type { FlowStep } from './flow';
import { AGENT_SKILL_FLOW } from './agent-skill';

/**
 * After login, the scan lists the repo's projects and the user picks one, as in
 * the legacy upload-source-maps program. The pick sets the framework preflight
 * resolves task skills against, and the project path the run is scoped to.
 */
const PICK_PROJECT_STEP: FlowStep = {
  id: 'detect',
  label: 'Detecting projects',
  screenId: 'error-tracking-detect',
  isComplete: (session) => session.integration != null,
};

export const ERROR_TRACKING_FLOW: FlowStep[] = AGENT_SKILL_FLOW.flatMap(
  (step): FlowStep[] => {
    if (step.id === 'intro') {
      return [{ ...step, screenId: 'error-tracking-intro' }];
    }
    if (step.id === 'auth') return [step, PICK_PROJECT_STEP];
    return [step];
  },
);
