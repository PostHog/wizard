import { getCommandPath, getSubcommandPrograms } from '@programs';
import { getTool } from '@tools';
import type { PlanOffer } from '@programs/types';
import type { PickerOption } from '@tui/primitives/index';
import type { DetectionRow } from '@tui/screens/IntroScreenLayout';

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
  'transactional-email',
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

/** The intro's row for a workspace whose project is picked after login, in place of a framework. */
export function introProjectsRow(plan: PlanOffer): DetectionRow {
  const offered = plan.projects.filter((project) => project.offered);
  // One project offered is the one the run takes; several are chosen among.
  return offered.length === 1
    ? { label: 'Project', value: offered[0].path }
    : {
        label: 'Projects',
        value: `${offered.length} found`,
        suffix: '(one is chosen after login)',
      };
}

export function introMenuOptions({
  view,
  showContinue,
  posthogSdkDetected,
  changeFramework = true,
}: {
  view: IntroMenuView;
  showContinue: boolean;
  posthogSdkDetected: boolean;
  /** False when the run leaves this project, so its framework is not the run's. */
  changeFramework?: boolean;
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
      ...(changeFramework
        ? [{ label: 'Change framework', value: 'framework' }]
        : []),
      { label: 'More info', value: 'more-info' },
      { label: 'Cancel', value: 'cancel' },
    ];
  }

  return null;
}
