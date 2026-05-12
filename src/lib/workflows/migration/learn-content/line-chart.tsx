/**
 * ASCII line chart — illustrates a Trends insight. Same shape as the
 * integration script's variant; kept separate so the migration narrative
 * can evolve independently.
 */

import { Text } from 'ink';
import type { ContentBlock } from '../../../../ui/tui/primitives/index.js';

export const LINE_CHART_BLOCK: ContentBlock = {
  type: 'lines',
  interval: 300,
  pause: 6000,
  lines: [
    <Text bold>{'  Trends · user signups (monthly)'}</Text>,
    <Text> </Text>,
    <Text>
      <Text color="gray">{'  10k ┤'}</Text>
      {'                          '}
      <Text color="cyan">{'╭──'}</Text>
      <Text dimColor>{' 9,575'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'      │'}</Text>
      {'                         '}
      <Text color="cyan">{'╭╯'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{' 7.5k ┤'}</Text>
      {'                        '}
      <Text color="cyan">{'╭╯'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'      │'}</Text>
      {'                      '}
      <Text color="cyan">{'╭─╯'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'   5k ┤'}</Text>
      {'                    '}
      <Text color="cyan">{'╭─╯'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'      │'}</Text>
      {'                 '}
      <Text color="cyan">{'╭──╯'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{' 2.5k ┤'}</Text>
      {'             '}
      <Text color="cyan">{'╭───╯'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'      │'}</Text>
      {'      '}
      <Text color="cyan">{'╭──────╯'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'    0 ┤'}</Text>
      <Text color="cyan">{'──────╯'}</Text>
    </Text>,
    <Text color="gray">{'      └┬─────┬─────┬─────┬─────┬──'}</Text>,
    <Text dimColor>{'       May   Aug   Nov   Feb   May'}</Text>,
  ],
};
