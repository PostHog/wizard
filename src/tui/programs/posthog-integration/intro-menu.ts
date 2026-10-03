import { getCommandPath, getSubcommandPrograms } from '@programs';
import { getTool } from '@tools';
import type { PickerOption } from '@tui/primitives/index';

export type IntroMenuView = 'default' | 'more-info' | 'commands';

export const CONTINUE_LABEL = 'Continue';
export const CONTINUE_ANYWAY_LABEL = 'Continue anyway';

export const DEFAULT_HEADLINE = "Let's do two hours of work in eight minutes.";
export const DETECTED_HEADLINE = [
  'It looks like PostHog is already installed. The Wizard has many tricks ' +
    'up its sleeve, like auditing, uploading source maps, or making your ' +
    'product self-drive.',
  'You can still rerun the installation, but it might overwrite some of your work.',
];

export function introHeadline(posthogSdkDetected: boolean): string[] {
  return posthogSdkDetected ? DETECTED_HEADLINE : [DEFAULT_HEADLINE];
}

/** What the spell book offers, in order: programs and tools. Curated: no config field ranks these. */
const INTRO_ENTRIES = [
  'self-driving',
  'error-tracking-upload-source-maps',
  'warehouse-source',
  'audit',
  'posthog-doctor',
  'mcp-analytics',
  'replay-vision',
  'ai-observability',
  'metrics',
  'revenue-analytics-setup',
];

/** One spell book row: the id the intro hands off to, the words that run it, and its help line. */
export type IntroEntry = { id: string; command: string; description: string };

/** The programs and tools the intro can hand off to, in the order it lists them. */
export function introEntries(): IntroEntry[] {
  const programs = new Map(getSubcommandPrograms().map((c) => [c.id, c]));
  return INTRO_ENTRIES.flatMap((id) => {
    const entry = programs.get(id) ?? getTool(id);
    return entry
      ? [{ id, command: getCommandPath(entry), description: entry.description }]
      : [];
  });
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
