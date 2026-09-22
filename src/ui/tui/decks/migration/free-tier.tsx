/**
 * PostHog free-tier highlights — the numbers a migrating team gets back when
 * they consolidate. Sourced from posthog.com/pricing.md.
 */

import { Text } from 'ink';
import { Colors } from '@ui/tui/styles';
import type { ContentBlock } from '@ui/tui/primitives/content-types';

export const FREE_TIER_BLOCK: ContentBlock = {
  type: 'lines',
  interval: 400,
  pause: 9000,
  lines: [
    <Text bold>{'  Free every month, on every product'}</Text>,
    <Text> </Text>,
    <Text>
      <Text color={Colors.accent}>{'  1,000,000  '}</Text>
      <Text>events </Text>
      <Text dimColor>product analytics</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'  1,000,000  '}</Text>
      <Text>requests </Text>
      <Text dimColor>feature flags + experiments</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'      5,000  '}</Text>
      <Text>recordings </Text>
      <Text dimColor>session replay</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'    100,000  '}</Text>
      <Text>exceptions </Text>
      <Text dimColor>error tracking</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'    100,000  '}</Text>
      <Text>events </Text>
      <Text dimColor>AI observability</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'      50 GB  '}</Text>
      <Text>logs </Text>
      <Text dimColor>logs</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'      1,500  '}</Text>
      <Text>responses </Text>
      <Text dimColor>surveys</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'  1,000,000  '}</Text>
      <Text>rows </Text>
      <Text dimColor>data warehouse</Text>
    </Text>,
  ],
};
