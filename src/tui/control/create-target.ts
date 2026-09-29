import { buildSession, type ProgramId } from '@programs';
import type { SessionArgs } from '@programs/types';
import type { ControlTarget } from '@shared/control/types';
import { WizardStore } from '../store.js';
import type { TuiLaunchChoices } from '../tui-state.js';
import { wizardStoreControlTarget } from './target.js';

/** A TUI store for `programId` with no terminal, driven through its control target alone. */
export function createTuiTarget(
  programId: ProgramId,
  session: SessionArgs & TuiLaunchChoices,
): ControlTarget {
  const store = new WizardStore(programId);
  store.launch(buildSession(session), session);
  return wizardStoreControlTarget(store);
}
