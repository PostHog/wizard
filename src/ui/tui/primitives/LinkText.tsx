/**
 * LinkText — renders prompt text with standalone URLs as OSC 8 hyperlinks.
 *
 * Each URL line is rendered on its own non-wrapping line (`wrap="truncate-end"`)
 * wrapped in an OSC 8 escape, so the click target is the full URL even when the
 * visible text is truncated to the overlay width — immune to the box border and
 * padding that corrupt a hard-wrapped URL. Prose renders unchanged.
 *
 * Used by the `wizard_ask` overlay only for programs that opt into rich link
 * rendering (see `PendingQuestion.richLinks`). Other flows are untouched.
 */
import { Box, Text } from 'ink';
import { Colors } from '@ui/tui/styles';
import { osc8Hyperlink, splitPromptIntoSegments } from './link-helpers.js';

interface LinkTextProps {
  text: string;
}

export const LinkText = ({ text }: LinkTextProps) => {
  const segments = splitPromptIntoSegments(text);
  return (
    <Box flexDirection="column">
      {segments.map((segment, i) =>
        segment.type === 'url' ? (
          <Text key={i} color={Colors.accent} underline wrap="truncate-end">
            {osc8Hyperlink(segment.value)}
          </Text>
        ) : (
          <Text key={i}>{segment.value}</Text>
        ),
      )}
    </Box>
  );
};
