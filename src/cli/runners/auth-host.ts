import { bindAuthHost } from '@programs';
import type { AuthHost } from '@programs/types';
import { getUI } from '../ui';
import { wizardAbort } from '../wizard-abort';

/** The current UI as the host a login needs; aborting ends the run unless the caller says otherwise. */
export function cliAuthHost(
  abort: AuthHost['abort'] = (failure) => wizardAbort(failure),
): AuthHost {
  return bindAuthHost(getUI(), abort);
}
