import type { PickerOption } from '@ui/tui/primitives/index';

export type IntroMenuView = 'default' | 'more-info' | 'commands';

export const CONTINUE_LABEL = 'Continue';
export const CONTINUE_ANYWAY_LABEL = 'Continue anyway';
// Shorter than the "wizard tricks" this was written as: IntroScreenLayout
// renders the menu in a 24-column box, and the label past that wraps mid-word.
export const COMMANDS_LABEL = 'Explore tricks';

export const DEFAULT_HEADLINE = "Let's do two hours of work in eight minutes.";
export const DETECTED_HEADLINE =
  'Looks like you already have PostHog installed.';

export function introHeadline(posthogSdkDetected: boolean): string {
  return posthogSdkDetected ? DETECTED_HEADLINE : DEFAULT_HEADLINE;
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
  // No route to the disclosure panel from either sub-view: it has its own
  // top-level row, which IntroScreenLayout appends to every intro menu.
  if (view === 'more-info' || view === 'commands') {
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
