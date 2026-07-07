/**
 * TipsDemo — preview the TipsCard for every program that ships its own
 * tips, plus the generic DEFAULT_TIPS fallback, in the same SplitView
 * layout the run screen uses. The run screen only shows tips after the
 * learn deck completes, so this is the direct way to review tip copy.
 *
 *   [ / ]   switch tip source (program tips / defaults)
 *
 * Arrow keys are reserved for the playground's tab switcher.
 */

import { Box, Text, useInput } from 'ink';
import { useMemo, useState } from 'react';
import { ProgressList, SplitView } from '@ui/tui/primitives/index';
import type { ProgressItem } from '@ui/tui/primitives/index';
import { Colors } from '@ui/tui/styles';
import type { WizardStore } from '@ui/tui/store';
import { TipsCard, DEFAULT_TIPS } from '@ui/tui/components/TipsCard';
import type { Tip } from '@ui/tui/components/TipsCard';
import { PROGRAM_REGISTRY } from '@lib/programs/program-registry';

interface TipSource {
  id: string;
  label: string;
  tips: Tip[];
}

const MOCK_TASKS: ProgressItem[] = [
  {
    label: 'Check Self-driving access',
    activeForm: 'Checking Self-driving access',
    status: 'completed',
  },
  {
    label: 'Connect GitHub (required)',
    activeForm: 'Connecting GitHub',
    status: 'in_progress',
  },
  {
    label: 'Configure the scout troop',
    activeForm: 'Configuring the scout troop',
    status: 'pending',
  },
];

interface TipsDemoProps {
  store: WizardStore;
}

export const TipsDemo = ({ store }: TipsDemoProps) => {
  const sources = useMemo<TipSource[]>(() => {
    const fromPrograms = Object.values(PROGRAM_REGISTRY)
      .filter((config) => config.getTips)
      .map((config) => ({
        id: config.id,
        label: config.id,
        tips: config.getTips?.(store) ?? [],
      }));
    return [
      ...fromPrograms,
      { id: 'default', label: 'DEFAULT_TIPS (fallback)', tips: DEFAULT_TIPS },
    ];
  }, [store]);

  const [sourceIdx, setSourceIdx] = useState(0);

  useInput((input) => {
    if (input === ']') {
      setSourceIdx((i) => (i + 1) % sources.length);
    } else if (input === '[') {
      setSourceIdx((i) => (i - 1 + sources.length) % sources.length);
    }
  });

  const source = sources[sourceIdx];

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text bold color={Colors.accent}>
        Tips previewer
      </Text>
      <Text dimColor>[ ] switch source</Text>
      <Box height={1} />
      <Text>
        <Text bold>Source:</Text> {source.label}{' '}
        <Text dimColor>
          ({sourceIdx + 1}/{sources.length} · {source.tips.length} tips)
        </Text>
      </Text>
      <Box height={1} />
      <Box flexGrow={1}>
        <SplitView
          left={<TipsCard store={store} tips={source.tips} />}
          right={<ProgressList items={MOCK_TASKS} title="Tasks" />}
        />
      </Box>
    </Box>
  );
};
