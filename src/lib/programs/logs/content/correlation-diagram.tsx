/**
 * CORRELATION_BLOCK — ASCII diagram of what the two log attributes buy you:
 * a log line carries `posthogDistinctId`, which resolves it to a person, and
 * `sessionId`, which resolves it to the replay of that person causing it.
 *
 * This is the whole pitch for logs living in PostHog rather than in a
 * standalone log vendor, so the deck draws it rather than describing it.
 *
 * Kept under ~38 chars wide so it fits the LearnCard pane at an 80-column
 * terminal.
 */

import { Text } from 'ink';
import { Colors } from '@ui/tui/styles';
import type { ContentBlock } from '@ui/tui/primitives/content-types';

export const CORRELATION_BLOCK: ContentBlock = {
  type: 'lines',
  interval: 320,
  pause: 9000,
  lines: [
    <Text>
      {'  '}
      <Text bold color="red">
        a log line
      </Text>
    </Text>,
    <Text dimColor>{'      "checkout failed: card declined"'}</Text>,
    <Text>
      <Text color="gray">{'  ↓ '}</Text>
      <Text bold color={Colors.accent}>
        posthogDistinctId
      </Text>
    </Text>,
    <Text>
      {'  '}
      <Text bold color="cyan">
        the person
      </Text>
      <Text dimColor> it happened to</Text>
    </Text>,
    <Text dimColor>{'      every log they ever caused'}</Text>,
    <Text>
      <Text color="gray">{'  ↓ '}</Text>
      <Text bold color={Colors.accent}>
        sessionId
      </Text>
    </Text>,
    <Text>
      {'  '}
      <Text bold color="green">
        the replay
      </Text>
      <Text dimColor> of them causing it</Text>
    </Text>,
    <Text dimColor>{'      watch the click that broke it'}</Text>,
  ],
};
