/**
 * ProjectPickerScreen: after login, lists the repo's projects and lets the person pick
 * the one the run works in. The project that starts selected comes first, so
 * Enter keeps the run's default. A project that is not eligible stays
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

/** The project's path from the repo root, written as a relative path. */
const where = (project: ProjectOption): string =>
  project.path === '.' ? './' : `./${project.path}`;

/** One project as a picker row: its path, its framework, and why it is greyed out. */
export function pickerOption(
  project: ProjectOption,
  selectedProjectPath: string,
): PickerOption<string> {
  const isSelected = project.path === selectedProjectPath;
  const hints = [
    // The root's reason already names it when it is listed as a workspace root.
    project.path === '.' && project.exclusionReason !== 'workspace-root'
      ? 'repo root'
      : undefined,
    project.frameworkName,
    project.isMainApp ? 'main app' : undefined,
    project.exclusionReason ? REASONS[project.exclusionReason] : undefined,
  ].filter((hint): hint is string => hint !== undefined);
  return {
    label: where(project),
    value: project.path,
    hint: hints.join(` ${Icons.bullet} `) || undefined,
    disabled: !project.eligible,
    icon: project.eligible
      ? { glyph: isSelected ? Icons.diamond : Icons.diamondOpen }
      : undefined,
  };
}

/** The picker's rows: the selected project first when it is eligible, then the other eligible ones, then the rest. */
export function pickerOptions(
  projects: readonly ProjectOption[],
  selectedProjectPath: string,
): PickerOption<string>[] {
  const rank = (project: ProjectOption): number => {
    if (!project.eligible) return 2;
    return project.path === selectedProjectPath ? 0 : 1;
  };
  return [...projects]
    .sort((a, b) => rank(a) - rank(b))
    .map((project) => pickerOption(project, selectedProjectPath));
}

export const ProjectPickerScreen = ({ store }: ProjectPickerScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const picker = store.projectSelection;
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
        {!selection.isDiscoveryComplete && (
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
          options={pickerOptions(
            selection.projects,
            selection.selectedProjectPath,
          )}
          onSelect={(value) => {
            const projectPath = Array.isArray(value) ? value[0] : value;
            store.confirmProjectPick(projectPath);
          }}
        />
      )}
    </Box>
  );
};
