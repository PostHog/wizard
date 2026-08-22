export type IntroMenuView = 'default' | 'more-info' | 'privacy' | 'commands';

export const CONTINUE_LABEL = 'Continue';
export const CONTINUE_ANYWAY_LABEL = 'Continue anyway';

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
}): { label: string; value: string }[] | null {
  if (view === 'more-info') {
    return [
      { label: 'Back', value: 'back' },
      { label: 'Privacy & data usage', value: 'privacy' },
    ];
  }

  if (view === 'privacy' || view === 'commands') {
    return [{ label: 'Back', value: 'back' }];
  }

  if (showContinue) {
    return [
      ...(posthogSdkDetected
        ? [{ label: 'Explore wizard tricks', value: 'commands' }]
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
