/**
 * ProgressDemo — Demonstrates ProgressList + LoadingBox.
 * Auto-animates task progression through states.
 */

import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import { ProgressList, LoadingBox } from '../../primitives/index.js';
import type { ProgressItem } from '../../primitives/index.js';
import { Colors } from '../../styles.js';

const INITIAL_ITEMS: ProgressItem[] = [
  {
    label: 'Detect framework',
    activeForm: 'Detecting framework',
    status: 'pending',
  },
  {
    label: 'Install dependencies',
    activeForm: 'Installing dependencies',
    status: 'pending',
  },
  {
    label: 'Configure PostHog',
    activeForm: 'Configuring PostHog',
    status: 'pending',
  },
  {
    label: 'Add analytics provider',
    activeForm: 'Adding analytics provider',
    status: 'pending',
  },
  { label: 'Verify setup', activeForm: 'Verifying setup', status: 'pending' },
];

export const ProgressDemo = () => {
  const [items, setItems] = useState<ProgressItem[]>(INITIAL_ITEMS);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, 1500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Cycle: each tick advances the "active" task
    const total = INITIAL_ITEMS.length;
    // After all tasks complete, restart
    const cycle = tick % (total + 2); // +2 for a pause at the end

    setItems(
      INITIAL_ITEMS.map((item, i) => {
        if (i < cycle) return { ...item, status: 'completed' as const };
        if (i === cycle) return { ...item, status: 'in_progress' as const };
        return { ...item, status: 'pending' as const };
      }),
    );
  }, [tick]);

  const allDone = items.every((i) => i.status === 'completed');

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        Progress Demo
      </Text>
      <Text dimColor>Tasks auto-advance every 1.5s (cycles continuously)</Text>
      <Box height={1} />
      <ProgressList items={items} title="Setup in progress:" />
      <Box height={1} />
      {!allDone && <LoadingBox message="Working..." />}
      {allDone && (
        <Text color={Colors.success} bold>
          {'\u2714'} All tasks complete! Restarting...
        </Text>
      )}
    </Box>
  );
};
