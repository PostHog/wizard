/**
 * ProjectPickerScreen: after login, lists the repo's projects and lets the person pick
 * the one the run works in. The project that starts picked comes first, so
 * Enter keeps the run's default. A project the program is not offered stays
 * listed, greyed, with its reason.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { ProjectOption, ProjectExclusionReason } from '@programs/types';
import type { WizardStore } from '@tui/store';
import {
  LoadingBox,
  PickerMenu,
  type PickerOption,
} from '@tui/primitives/index';
import { Colors, Icons } from '@tui/styles';

interface ProjectPickerScreenProps {
  store: WizardStore;
}

const REASONS: Record<ProjectExclusionReason, string> = {
  'has-posthog': 'already has PostHog',
  'unsupported-framework': 'unsupported framework',
  library: 'library',
  tooling: 'tooling',
  'workspace-root': 'workspace root',
  'not-applicable': 'not set up by this command',
};

const where = (project: ProjectOption): string =>
  project.path === '.' ? 'repo root' : project.path;

/** One project as a picker row: its path, its framework, and why it is greyed out. */
export function pickerOption(
  project: ProjectOption,
  picked: string,
): PickerOption<string> {
  const isPicked = project.path === picked;
  const hints = [
    project.frameworkName,
    project.mainApp ? 'main app' : undefined,
    project.reason ? REASONS[project.reason] : undefined,
  ].filter((hint): hint is string => hint !== undefined);
  return {
    label: where(project),
    value: project.path,
    hint: hints.join(` ${Icons.bullet} `) || undefined,
    disabled: !project.offered,
    icon: project.offered
      ? { glyph: isPicked ? Icons.diamond : Icons.diamondOpen }
      : undefined,
  };
}

/** The picker's rows: the picked project first when it is offered, then the others offered, then the rest. */
export function pickerOptions(
  projects: readonly ProjectOption[],
  picked: string,
): PickerOption<string>[] {
  const rank = (project: ProjectOption): number => {
    if (!project.offered) return 2;
    return project.path === picked ? 0 : 1;
  };
  return [...projects]
    .sort((a, b) => rank(a) - rank(b))
    .map((project) => pickerOption(project, picked));
}

export const ProjectPickerScreen = ({ store }: ProjectPickerScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const picker = store.projectPicker;
  if (!picker) return <LoadingBox message="Looking for your projects..." />;
  const { selection, ranking } = picker;

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.accent}>
          {Icons.check} Found{' '}
          {selection.repoType === 'monorepo'
            ? `a ${selection.workspaceTool ?? ''} monorepo`.replace('  ', ' ')
            : 'several projects'}
        </Text>
        {!selection.complete && (
          <Text dimColor>
            This repo is large, so some projects may be missing.
          </Text>
        )}
      </Box>

      {ranking ? (
        <LoadingBox message="Finding the main app..." />
      ) : (
        <PickerMenu
          message="Which project should PostHog be set up in?"
          options={pickerOptions(selection.projects, selection.picked)}
          onSelect={(value) => {
            const projectPath = Array.isArray(value) ? value[0] : value;
            store.confirmProjectPick(projectPath);
          }}
        />
      )}
    </Box>
  );
};
