import { OutroKind, type WizardSession } from '../session/wizard-session.js';

/** The agent run ended in an error, whatever the reason. Login failures also
 *  set an error outro but never had credentials, so they stay on the outro. */
export function isRunFailure(
  session: Pick<WizardSession, 'outroData' | 'credentials'>,
): boolean {
  return (
    session.outroData?.kind === OutroKind.Error && session.credentials !== null
  );
}
