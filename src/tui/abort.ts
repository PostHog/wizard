/** A decided failure in the TUI: the outro screen shows it, and the run ends once the user is done with it. */
import { wizardAbort, type WizardAbortOptions } from '@host/wizard-abort';
import { ScreenId } from './screen-ids.js';
import type { WizardStore } from './store.js';

/** `wizardAbort` with the outro screen as its presenter and the store's exit request as its end. */
export function abortOnScreens(
  store: WizardStore,
  options?: WizardAbortOptions,
): Promise<never> {
  return wizardAbort(
    {
      present: async (outro) => {
        store.showOutroError(outro);
        // The MintFailure handoff never sets outroDismissed, so leaving it
        // counts, as does continuing through the post-run steps to the exit.
        await store.waitUntil(
          (s) =>
            s.outroDismissed ||
            s.mintHandoff === 'exit' ||
            (s.mintHandoff === 'continue' &&
              store.currentScreen === ScreenId.Exit),
        );
      },
      exit: { end: (code) => store.requestExit(code) },
    },
    options,
  );
}
