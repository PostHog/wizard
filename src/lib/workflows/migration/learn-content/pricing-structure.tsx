/**
 * Pricing structure block — what happens after the free tier.
 */

import { Text } from 'ink';
import { Colors } from '../../../../ui/tui/styles.js';
import type { ContentBlock } from '../../../../ui/tui/primitives/index.js';

export const PRICING_STRUCTURE_BLOCK: ContentBlock = {
  type: 'lines',
  interval: 500,
  pause: 8000,
  lines: [
    <Text bold>{'  After the free tier'}</Text>,
    <Text> </Text>,
    <Text>
      <Text color={Colors.accent}>{'  $0 '}</Text>
      <Text>base price · pay only for what you use</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'  ◆ '}</Text>
      <Text>per-event prices decrease with volume</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'  ◆ '}</Text>
      <Text>no per-seat charges — your whole team is included</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'  ◆ '}</Text>
      <Text>web analytics bundled with product analytics</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'  ◆ '}</Text>
      <Text>experiments bundled with feature flags</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'  ◆ '}</Text>
      <Text>revenue analytics bundled with data warehouse</Text>
    </Text>,
  ],
};
