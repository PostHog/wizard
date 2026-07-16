/**
 * LinkText — renders prompt text with URLs as OSC 8 hyperlinks.
 *
 * Each URL is pulled onto its own line and truncated for display, so it never
 * wraps; the OSC 8 escape still carries the full URL as the click target, and
 * `WizardAskScreen` opens (`o`) / copies (`c`) the full URL too. Prose renders
 * unchanged.
 *
 * Used by the `wizard_ask` overlay only for programs that opt into rich link
 * rendering (see `PendingQuestion.richLinks`). Other flows are untouched.
 */
import { Box, Text } from 'ink';
import { Colors } from '@ui/tui/styles';
import {
  osc8Hyperlink,
  truncateUrlLabel,
  splitPromptIntoSegments,
} from './link-helpers.js';

interface LinkTextProps {
  text: string;
}

export const LinkText = ({ text }: LinkTextProps) => {
  const segments = splitPromptIntoSegments(text);
  return (
    <Box flexDirection="column">
      {segments.map((segment, i) =>
        segment.type === 'url' ? (
          <Text key={i} color={Colors.accent} underline wrap="truncate">
            {osc8Hyperlink(segment.value, truncateUrlLabel(segment.value))}
          </Text>
        ) : (
          <Text key={i}>{segment.value}</Text>
        ),
      )}
    </Box>
  );
};
