/**
 * LinkText — renders prompt text with standalone URLs as OSC 8 hyperlinks.
 *
 * Each URL gets its own line, wrapped (`wrap="wrap"`) so the full URL is shown
 * within the overlay instead of truncated — the user can read and select all of
 * it. Ink's wrap (wrap-ansi) re-emits the OSC 8 escape on every wrapped visual
 * line, so the click target stays the exact, full URL no matter where the
 * visible text breaks. A manual selection of a wrapped line still picks up the
 * line break, so for a clean copy `WizardAskScreen` auto-copies a sole URL to
 * the clipboard. Prose renders unchanged.
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
          <Text key={i} color={Colors.accent} underline wrap="wrap">
            {osc8Hyperlink(segment.value)}
          </Text>
        ) : (
          <Text key={i}>{segment.value}</Text>
        ),
      )}
    </Box>
  );
};
