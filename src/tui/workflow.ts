/** The TUI's answers to the steps `runProgram` waits on: its screens, gates and overlays. */
import { RunOutcome } from '@programs';
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
    finishStep(step, result) {
      // Only a composed sub-run that succeeded completes its step; a failed one keeps its tasks for the outro and the stream. The program's run step follows its phase.
      if (
        step.programId !== programId &&
        result.outcome === RunOutcome.Success
      ) {
        store.completeRunStep(step.stepId);
      }
    },
  };
}
