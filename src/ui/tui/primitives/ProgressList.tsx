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
  const resolved = items.filter(
    (t) => t.status === 'completed' || t.status === 'skipped',
  ).length;
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
        const skipped = item.status === 'skipped';
        const icon = skipped
          ? Icons.diamondOpen
          : item.status === 'completed'
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

        // One row per task: the pane is half the terminal, so truncate rather
        // than wrap, and lead with the status note so it survives truncation.
        return (
          <Text key={i} wrap="truncate">
            <Text color={color}>{icon}</Text>{' '}
            {skipped ? (
              <>
                <Text dimColor italic>
                  not needed{' '}
                </Text>
                <Text dimColor strikethrough>
                  {item.label}
                </Text>
              </>
            ) : (
              <Text dimColor={item.status === 'pending'}>{label}</Text>
            )}
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
    </Box>
  );
};
