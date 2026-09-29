/** The TUI's answers to the steps `runProgram` waits on: its screens, gates and overlays. */
import type { ProgramId, ProgramWorkflowConnector } from '@programs/types';
import type { WizardStore } from './store.js';

export function tuiWorkflow(
  store: WizardStore,
  programId: ProgramId,
): ProgramWorkflowConnector {
  return {
    async confirmStep(step) {
      switch (step.kind) {
        case 'ai-approval':
          // AiOptInRequiredScreen holds here, before any source leaves the machine.
          await store.getGate('ai-opt-in');
          return true;
        case 'service-outage':
          // The health-check screen shows the outage; the run stops.
          store.setReadinessResult(step.readiness);
          return false;
        case 'settings-conflict':
          await store.showSettingsOverride(step.conflicts, step.fix);
          return true;
        case 'run':
          // Each screen before the run's step settles first; a hidden step doesn't run.
          return store.reachStep(step.stepId);
      }
    },
    finishStep(step) {
      // A composed sub-run's step completes on its own; the program's run step follows its phase.
      if (step.programId !== programId) store.completeRunStep(step.stepId);
    },
  };
}
