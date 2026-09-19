import { flowFor } from '../programs/flow-for.js';
import { Program, type ProgramId } from '../programs/program-registry.js';
import { WizardStore } from '../state/store.js';

/** A real store on a real program flow; tests fake nothing below it. */
export function createTestStore(
  programId: ProgramId = Program.PostHogIntegration,
): WizardStore {
  return new WizardStore(flowFor(programId).flow);
}
