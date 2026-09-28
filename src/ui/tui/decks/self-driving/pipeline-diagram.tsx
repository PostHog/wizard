/**
 * PIPELINE_BLOCK — ASCII diagram of the Self-driving loop: sources feed
 * scouts, scouts raise signals, signals group into reports, reports land
 * in the inbox, shipped fixes get measured, and misses loop back as new
 * signals. Kept under ~38 chars wide so it fits the LearnCard pane at an
 * 80-column terminal.
 */

import { Text } from 'ink';
import { Colors } from '@ui/tui/styles';
import type { ContentBlock } from '@ui/tui/primitives/content-types';

export const PIPELINE_BLOCK: ContentBlock = {
  type: 'lines',
  interval: 300,
  pause: 8000,
  lines: [
    <Text>
      {'  '}
      <Text bold color="cyan">
        signal sources
      </Text>
    </Text>,
    <Text dimColor>{'      errors · replays · support'}</Text>,
    <Text>
      <Text color="gray">{'  ↓ '}</Text>
      <Text bold color={Colors.accent}>
        scouts
      </Text>
    </Text>,
    <Text dimColor>{'      watching on a schedule'}</Text>,
    <Text>
      <Text color="gray">{'  ↓ '}</Text>
      <Text bold color={Colors.accent}>
        signals
      </Text>
    </Text>,
    <Text dimColor>{'      finding + evidence + action'}</Text>,
    <Text>
      <Text color="gray">{'  ↓ '}</Text>
      <Text bold color={Colors.accent}>
        reports
      </Text>
    </Text>,
    <Text dimColor>{'      grouped and prioritized'}</Text>,
    <Text>
      <Text color="gray">{'  ↓ '}</Text>
      <Text bold color="green">
        your inbox
      </Text>
    </Text>,
    <Text dimColor>{'      investigate · tag · ship a PR'}</Text>,
    <Text>
      <Text color="gray">{'  ↓ '}</Text>
      <Text bold color={Colors.accent}>
        measured
      </Text>
    </Text>,
    <Text>
      <Text color="cyan">{'  ↺ '}</Text>
      <Text dimColor>didn't fix it? a new signal</Text>
    </Text>,
  ],
};
