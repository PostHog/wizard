import { bindAuthHost } from '@programs';
import type { AuthHost } from '@programs/types';
import { wizardAbort } from '@utils/wizard-abort';
import { InkUI } from './ink-ui.js';
import type { WizardStore } from './store.js';

/** The TUI's own UI as the host a login needs; aborting ends the run. */
export function tuiAuthHost(store: WizardStore): AuthHost {
  return bindAuthHost(new InkUI(store), (failure) => wizardAbort(failure));
}
