import type { PickerOption } from '@ui/tui/primitives/index';

export type IntroMenuView = 'default' | 'more-info' | 'commands';

export const CONTINUE_LABEL = 'Continue';
export const CONTINUE_ANYWAY_LABEL = 'Continue anyway';
// Two words shorter than the prose calls it: IntroScreenLayout renders the
// menu in a 24-column box, and a label past that wraps mid-word.
export const COMMANDS_LABEL = 'Explore spell book';

export const DEFAULT_HEADLINE = "Let's do two hours of work in eight minutes.";
export const DETECTED_HEADLINE = [
  'It looks like PostHog is already installed. The Wizard has many tricks ' +
    'up its sleeve, like auditing, uploading source maps, or making your ' +
    'product self-drive.',
  'You can still rerun the command, but it might overwrite some of your work.',
];

/** Paragraphs, so the detected state can say more than the clean one. */
export function introHeadline(posthogSdkDetected: boolean): string[] {
  return posthogSdkDetected ? DETECTED_HEADLINE : [DEFAULT_HEADLINE];
}

export function introMenuOptions({
  view,
  showContinue,
  posthogSdkDetected,
}: {
  view: IntroMenuView;
  showContinue: boolean;
  posthogSdkDetected: boolean;
}): PickerOption<string>[] | null {
  // Nothing scopes arrow keys to one picker, so a menu under the command list
  // would move both cursors at once. That view puts a picker in the body slot
  // and owns the interaction; Esc is its way back. Same shape as the framework
  // picker, which clears the menu while it's up.
  if (view === 'commands') return null;

  // No route to the disclosure panel from here: it has its own top-level row,
  // which IntroScreenLayout appends to every intro menu.
  if (view === 'more-info') {
    return [{ label: 'Back', value: 'back' }];
  }

  if (showContinue) {
    return [
      ...(posthogSdkDetected
        ? [{ label: COMMANDS_LABEL, value: 'commands' }]
        : []),
      {
        label: posthogSdkDetected ? CONTINUE_ANYWAY_LABEL : CONTINUE_LABEL,
        value: 'continue',
      },
      { label: 'Change framework', value: 'framework' },
      { label: 'More info', value: 'more-info' },
      { label: 'Cancel', value: 'cancel' },
    ];
  }

  return null;
}
