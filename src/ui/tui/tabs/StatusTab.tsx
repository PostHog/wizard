/**
 * StatusTab — Task checklist tab for the Run screen.
 * Shows task progression from SDK TodoWrite events, plus any mid-run prompts.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import { TaskStatus, type WizardStore } from '../store.js';
import { PromptRenderer } from '../components/PromptRenderer.js';

interface StatusTabProps {
  store: WizardStore;
}

export const StatusTab = ({ store }: StatusTabProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { pendingPrompt, tasks } = store;

  const completed = tasks.filter((t) => t.done).length;
  const total = tasks.length;

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      {tasks.length > 0 && (
        <Box flexDirection="column">
          <Text bold>Setup in progress:</Text>
          <Text> </Text>
          {tasks.map((task, i) => {
            const icon =
              task.status === TaskStatus.Completed
                ? '\u25FC'
                : task.status === TaskStatus.InProgress
                ? '\u25B6'
                : '\u25FB';
            const color =
              task.status === TaskStatus.Completed
                ? 'green'
                : task.status === TaskStatus.InProgress
                ? 'cyan'
                : 'gray';
            const label =
              task.status === TaskStatus.InProgress && task.activeForm
                ? task.activeForm
                : task.label;

            return (
              <Text key={i}>
                <Text color={color}>{icon}</Text>
                <Text dimColor={task.status === TaskStatus.Pending}>
                  {' '}
                  {label}
                </Text>
              </Text>
            );
          })}
          {total > 0 && (
            <Box marginTop={1}>
              <Text dimColor>
                Progress: {completed}/{total} completed
              </Text>
            </Box>
          )}
        </Box>
      )}

      {/* Mid-run prompt (rare) */}
      {pendingPrompt && (
        <PromptRenderer prompt={pendingPrompt} store={store} marginTop={1} />
      )}

      {/* Empty state — before todos arrive */}
      {tasks.length === 0 && !pendingPrompt && (
        <Box flexDirection="column">
          <Text bold>Setup in progress:</Text>
          <Text> </Text>
          <Text dimColor>
            This usually takes about 8 minutes. The agent will show progress
            here as it works.
          </Text>
        </Box>
      )}
    </Box>
  );
};
