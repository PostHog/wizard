/**
 * Vendor cost stack — the multi-tool baseline a typical migration target has
 * before consolidating onto PostHog. Numbers from each vendor's published
 * starter pricing.
 */

import { Text } from 'ink';
import type { ContentBlock } from '../../../../ui/tui/primitives/index.js';

export const VENDOR_STACK_BLOCK: ContentBlock = {
  type: 'lines',
  interval: 600,
  pause: 9000,
  lines: [
    <Text bold>{'  Typical pre-migration stack'}</Text>,
    <Text> </Text>,
    <Text>
      <Text color="gray">{'  Sentry'}</Text>
      <Text>{'         error tracking      '}</Text>
      <Text color="red">{'$26/mo+'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  LaunchDarkly'}</Text>
      <Text>{'   feature flags       '}</Text>
      <Text color="red">{'$8.33/mo+'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  Amplitude'}</Text>
      <Text>{'      product analytics   '}</Text>
      <Text color="red">{'$49/mo+'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  Braintrust'}</Text>
      <Text>{'     LLM analytics       '}</Text>
      <Text color="red">{'$50/mo+'}</Text>
    </Text>,
    <Text color="gray">{'  ─────────────────────────────────────'}</Text>,
    <Text>
      <Text>{'  Total'}</Text>
      <Text>{'                              '}</Text>
      <Text bold color="red">
        {'$133/mo+'}
      </Text>
    </Text>,
    <Text dimColor>{'  plus ~450KB of JavaScript SDKs'}</Text>,
  ],
};
