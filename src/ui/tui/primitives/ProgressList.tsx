/**
 * ProgressList — Reusable task checklist with status icons.
 * Extracted from StatusTab logic.
 */

import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import { Colors, Icons } from '@ui/tui/styles';
import { LoadingBox } from './LoadingBox.js';

export interface ProgressItem {
  label: string;
  activeForm?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
}

interface ProgressListProps {
  items: ProgressItem[];
  title?: string;
}

export const ProgressList = ({ items, title }: ProgressListProps) => {
  // A task found not needed leaves the list — it was never work to show.
  const visible = items.filter((t) => t.status !== 'skipped');
  const resolved = visible.filter((t) => t.status === 'completed').length;
  const total = visible.length;
  const notRequired = items.length - visible.length;

  return (
    <Box flexDirection="column">
      {title && (
        <>
          <Text bold>{title}</Text>
          <Text> </Text>
        </>
      )}
      {visible.length === 0 && <LoadingBox message="Analyzing project..." />}
      {visible.map((item, i) => {
        const icon =
          item.status === 'completed'
            ? Icons.squareFilled
            : item.status === 'in_progress'
            ? Icons.triangleRight
            : Icons.squareOpen;
        const color =
          item.status === 'completed'
            ? Colors.success
            : item.status === 'in_progress'
            ? Colors.primary
            : Colors.muted;
        const label =
          item.status === 'in_progress' && item.activeForm
            ? item.activeForm
            : item.label;

        // One row per task: the pane is half the terminal, so truncate.
        return (
          <Text key={i} wrap="truncate">
            <Text color={color}>{icon}</Text>{' '}
            <Text dimColor={item.status === 'pending'}>{label}</Text>
          </Text>
        );
      })}
      {total > 0 && (
        <Box marginTop={1} gap={1}>
          <Spinner />
          <Text dimColor>
            {resolved < total
              ? `Progress: ${resolved}/${total} completed`
              : 'Cleaning up...'}
          </Text>
        </Box>
      )}
      {notRequired > 0 && (
        <Text dimColor>({notRequired} skipped as not required)</Text>
      )}
    </Box>
  );
};
