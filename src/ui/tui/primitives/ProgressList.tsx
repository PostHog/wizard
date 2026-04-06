/**
 * ProgressList — Reusable task checklist with status icons.
 * Extracted from StatusTab logic.
 */

import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import { Colors, Icons } from '@tui/styles.js';
import { LoadingBox } from './LoadingBox.js';
import { TaskStatus } from '@ui/wizard-ui.js';

export interface ProgressItem {
  label: string;
  activeForm?: string;
  status: TaskStatus;
  /** Nesting depth — 0 = top-level, 1 = nested under a stage, etc. */
  indent?: number;
}

interface ProgressListProps {
  items: ProgressItem[];
  title?: string;
}

export const ProgressList = ({ items, title }: ProgressListProps) => {
  const completed = items.filter((t) => t.status === 'completed').length;
  const total = items.length;

  return (
    <Box flexDirection="column">
      {title && (
        <>
          <Text bold>{title}</Text>
          <Text> </Text>
        </>
      )}
      {items.length === 0 && <LoadingBox message="Analyzing project..." />}
      {items.map((item, i) => {
        const icon =
          item.status === TaskStatus.Completed
            ? Icons.squareFilled
            : item.status === TaskStatus.InProgress
            ? Icons.triangleRight
            : Icons.squareOpen;
        const color =
          item.status === TaskStatus.Completed
            ? Colors.success
            : item.status === TaskStatus.InProgress
            ? Colors.primary
            : Colors.muted;
        const label =
          item.status === TaskStatus.InProgress && item.activeForm
            ? item.activeForm
            : item.label;

        const pad = item.indent ? '  '.repeat(item.indent) : '';

        return (
          <Text key={i}>
            <Text>{pad}</Text>
            <Text color={color}>{icon}</Text>
            <Text dimColor={item.status === TaskStatus.Pending}> {label}</Text>
          </Text>
        );
      })}
      {total > 0 && (
        <Box marginTop={1} gap={1}>
          <Spinner />
          <Text dimColor>
            {completed < total
              ? `Progress: ${completed}/${total} completed`
              : 'Cleaning up...'}
          </Text>
        </Box>
      )}
    </Box>
  );
};
