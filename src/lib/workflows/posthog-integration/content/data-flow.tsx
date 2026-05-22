/**
 * POSTHOG_DATA_FLOW — ASCII diagram of the PostHog event ingestion flow.
 */

import { Text } from 'ink';
import { Colors } from '../../../../ui/tui/styles.js';
import type { ContentBlock } from '../../../../ui/tui/primitives/content-types.js';

export const POSTHOG_DATA_FLOW: ContentBlock = {
  type: 'lines',
  interval: 500,
  pause: 8000,
  // Box is 30 chars wide between │ borders.
  // Labels: 1-char indent. Arrows: "   ↓ " (5). Sub-items: "   │   " (7).
  lines: [
    <Text color="gray">{'  ┌──────────────────────────────┐'}</Text>,
    <Text>
      <Text color="gray">{'  │ '}</Text>
      <Text bold color="cyan">
        Your App
      </Text>
      <Text color="gray">{'                     │'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  │   │ '}</Text>
      <Text>posthog.capture()</Text>
      <Text color="gray">{'        │'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  │   │  '}</Text>
      <Text dimColor>custom events</Text>
      <Text color="gray">{'           │'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  │   │  '}</Text>
      <Text dimColor>custom properties</Text>
      <Text color="gray">{'       │'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  │   │  '}</Text>
      <Text dimColor>person profiles</Text>
      <Text color="gray">{'         │'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  │   ↓  '}</Text>
      <Text dimColor>groups</Text>
      <Text color="gray">{'                  │'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  │ '}</Text>
      <Text bold color={Colors.accent}>
        PostHog SDK
      </Text>
      <Text color="gray">{'                  │'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  │   ↓ '}</Text>
      <Text>HTTP</Text>
      <Text color="gray">{'                     │'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  │ '}</Text>
      <Text bold color={Colors.accent}>
        PostHog Cloud
      </Text>
      <Text color="gray">{'                │'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  │   ↓ '}</Text>
      <Text>query + visualize</Text>
      <Text color="gray">{'        │'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  │ '}</Text>
      <Text bold color="green">
        Dashboards & Insights
      </Text>
      <Text color="gray">{'        │'}</Text>
    </Text>,
    <Text color="gray">{'  └──────────────────────────────┘'}</Text>,
  ],
};
