import { bindAuthHost } from '@programs';
import type { AuthHost } from '@programs/types';
import { getUI } from '@cli/ui';
import { wizardAbort } from '@cli/wizard-abort';

/** The current UI as the host a login needs; aborting ends the run. */
export function cliAuthHost(): AuthHost {
  return bindAuthHost(getUI(), (failure) => wizardAbort(failure));
}
