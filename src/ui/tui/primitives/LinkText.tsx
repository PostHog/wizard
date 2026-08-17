/**
 * LinkText — renders prompt text with URLs as OSC 8 hyperlinks.
 *
 * Every URL (standalone or inline in prose) is pulled onto its own line. Long
 * URLs are truncated for display (`scheme://host` kept, the noisy path/query
 * tail collapsed to an ellipsis) so the overlay stays clean instead of a URL
 * wrapping across several lines. The OSC 8 escape carries the *full* URL as the
 * click target regardless of the shortened label, and `WizardAskScreen` opens
 * (`o`) / copies (`c`) the full URL too, so no path loses the real destination.
 * Prose renders unchanged.
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
          <Text key={i} color={Colors.accent} underline wrap="wrap">
            {osc8Hyperlink(segment.value, truncateUrlLabel(segment.value))}
          </Text>
        ) : (
          <Text key={i}>{segment.value}</Text>
        ),
      )}
    </Box>
  );
};
