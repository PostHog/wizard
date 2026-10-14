/**
 * The sharing choice a program intro offers on its privacy view. Every program
 * that scans the codebase (`scansCodebase`) shows the same rows, so consent
 * reads and behaves the same wherever it is asked.
 */

import { ScanConsent } from '@shared/run-state';
import type { PickerOption } from '@tui/primitives/index';
import type { WizardStore } from '@tui/store';
import { Icons } from '@tui/styles';

/**
 * A blank, unselectable row. Navigation skips disabled options, so this is a
 * margin the menu can hold rather than one the layout has to special-case.
 */
const MENU_SPACER: PickerOption<string> = {
  label: '',
  value: 'spacer',
  disabled: true,
};

/**
 * The sharing choice, as two explicit rows rather than one toggle. A toggle
 * label has to describe either the current state or the next action, and a
 * reader cannot tell which; two rows with the filled diamond on the live one
 * say both at once. The trailing spacer separates them from the Back that
 * IntroScreenLayout appends, since leaving the screen is a different kind of
 * act from changing something on it.
 */
export function sharingOptions(sharing: boolean): PickerOption<string>[] {
  const mark = (on: boolean) => ({
    glyph: on ? Icons.diamond : Icons.diamondOpen,
  });
  return [
    { label: 'Share tools', value: 'share', icon: mark(sharing) },
    { label: "Don't share tools", value: 'no-share', icon: mark(!sharing) },
    MENU_SPACER,
  ];
}

type SharingStore = Pick<
  WizardStore,
  'session' | 'grantSharing' | 'declineSharing'
>;

/** Sharing is on by default, so only an explicit decline turns it off. */
export function isSharing(store: SharingStore): boolean {
  return store.session.scanConsent !== ScanConsent.Declined;
}

/** Apply a sharing row the user picked. Returns false for any other value. */
export function applySharingChoice(
  store: SharingStore,
  value: string,
): boolean {
  if (value === 'share') store.grantSharing();
  else if (value === 'no-share') store.declineSharing();
  else return false;
  return true;
}

/** Continue with no choice made means sharing, the default. A choice already made stands. */
export function resolveSharingOnContinue(store: SharingStore): void {
  if (store.session.scanConsent === ScanConsent.Undecided) store.grantSharing();
}
