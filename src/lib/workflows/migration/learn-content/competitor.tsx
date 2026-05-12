import { Text } from 'ink';
import type { ContentBlock } from '../../../../ui/tui/primitives/index.js';

export const COMPETITOR_BLOCK: ContentBlock = {
  type: 'lines',
  interval: 200,
  pause: 7000,
  lines: [
    <Text color="gray">{'    ╔═══════════════════════════╗'}</Text>,
    <Text>
      <Text color="gray">{'    ║'}</Text>
      <Text>{'         _________         '}</Text>
      <Text color="gray">{'║'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'    ║'}</Text>
      <Text>{'        /         \\        '}</Text>
      <Text color="gray">{'║'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'    ║'}</Text>
      <Text>{'       /   '}</Text>
      <Text bold>R.I.P</Text>
      <Text>{'   \\       '}</Text>
      <Text color="gray">{'║'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'    ║'}</Text>
      <Text>{'      |   ~~~~~~    |      '}</Text>
      <Text color="gray">{'║'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'    ║'}</Text>
      <Text>{'      |             |      '}</Text>
      <Text color="gray">{'║'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'    ║'}</Text>
      <Text>{'      | '}</Text>
      <Text bold>COMPETITOR</Text>
      <Text>{'  |      '}</Text>
      <Text color="gray">{'║'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'    ║'}</Text>
      <Text>{'      |   ~~~~~~    |      '}</Text>
      <Text color="gray">{'║'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'    ║'}</Text>
      <Text>{'      |    2026     |      '}</Text>
      <Text color="gray">{'║'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'    ║'}</Text>
      <Text>{'      |_____________|      '}</Text>
      <Text color="gray">{'║'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'    ║'}</Text>
      <Text dimColor>{'     ░░░░░░░░░░░░░░░░░     '}</Text>
      <Text color="gray">{'║'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'    ║'}</Text>
      <Text>{'      🌸  🌺  🌼  🌻       '}</Text>
      <Text color="gray">{'║'}</Text>
    </Text>,
    <Text color="gray">{'    ╚═══════════════════════════╝'}</Text>,
  ],
};
