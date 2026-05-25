/**
 * LINE_CHART_BLOCK — ASCII trends chart illustrating an insight.
 */

import { Text } from 'ink';
import type { ContentBlock } from '../../../../ui/tui/primitives/content-types.js';

export const LINE_CHART_BLOCK: ContentBlock = {
  type: 'lines',
  interval: 300,
  pause: 6000,
  lines: [
    <Text bold>{'  Trends · user signups (monthly)'}</Text>,
    <Text> </Text>,
    // 10k
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
    // 7.5k
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
    // 5k
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
    // 2.5k
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
    // 0
    <Text>
      <Text color="gray">{'    0 ┤'}</Text>
      <Text color="cyan">{'──────╯'}</Text>
    </Text>,
    // X-axis
    <Text color="gray">{'      └┬─────┬─────┬─────┬─────┬──'}</Text>,
    <Text dimColor>{'       May   Aug   Nov   Feb   May'}</Text>,
  ],
};
