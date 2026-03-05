/**
 * ProgressList — Reusable task checklist with status icons.
 * Extracted from StatusTab logic.
 */

import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import { Colors, Icons } from '../styles.js';
import { LoadingBox } from './LoadingBox.js';

export interface ProgressItem {
  label: string;
  activeForm?: string;
  status: 'pending' | 'in_progress' | 'completed';
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

        return (
          <Text key={i}>
            <Text color={color}>{icon}</Text>
            <Text dimColor={item.status === 'pending'}> {label}</Text>
          </Text>
        );
      })}
      {total > 0 && (
        <Box marginTop={1} gap={1}>
          {completed < total && <Spinner />}
          <Text dimColor>
            Progress: {completed}/{total} completed
          </Text>
        </Box>
      )}
    </Box>
  );
};
