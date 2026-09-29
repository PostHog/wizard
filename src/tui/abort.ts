/** A decided failure in the TUI: the outro screen shows it, and the run ends once the user is done with it. */
import { wizardAbort, type WizardAbortOptions } from '@host/wizard-abort';
import type { WizardStore } from './store.js';

/** `wizardAbort` with the outro screen as its presenter. */
export function abortOnScreens(
  store: WizardStore,
  options?: WizardAbortOptions,
): Promise<never> {
  return wizardAbort(async (outro) => {
    store.showOutroError(outro);
    // The MintFailure handoff never sets outroDismissed, so leaving it counts.
    await store.waitUntil(
      (s) => s.outroDismissed || s.mintHandoff === 'exit' || s.skillsComplete,
    );
  }, options);
}
