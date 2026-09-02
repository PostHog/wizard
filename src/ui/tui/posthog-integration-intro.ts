import type { PickerOption } from '@ui/tui/primitives/index';

export type IntroMenuView = 'default' | 'more-info' | 'commands';

export const CONTINUE_LABEL = 'Continue';
export const CONTINUE_ANYWAY_LABEL = 'Continue anyway';

export const DEFAULT_HEADLINE = "Let's do two hours of work in eight minutes.";
export const DETECTED_HEADLINE = [
  'It looks like PostHog is already installed. The Wizard has many tricks ' +
    'up its sleeve, like auditing, uploading source maps, or making your ' +
    'product self-drive.',
  'You can still rerun the command, but it might overwrite some of your work.',
];

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
  // Its body is a picker, and a second menu here would move both cursors.
  if (view === 'commands') return null;

  if (view === 'more-info') {
    return [{ label: 'Back', value: 'back' }];
  }

  if (showContinue) {
    return [
      ...(posthogSdkDetected
        ? [{ label: 'Explore spell book', value: 'commands' }]
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
