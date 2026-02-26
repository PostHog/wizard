import { Box, Text, useStdout } from 'ink';
import { Colors } from '../styles.js';

const MIN_WIDTH = 80;
const MAX_WIDTH = 120;
const FEEDBACK = 'Feedback: wizard@posthog.com ';

interface TitleBarProps {
  version: string;
}

export const TitleBar = ({ version }: TitleBarProps) => {
  const { stdout } = useStdout();
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, stdout.columns));
  const title = ` PostHog Setup Wizard v${version}`;
  const gap = width - title.length - FEEDBACK.length;
  const padding = gap > 0 ? ' '.repeat(gap) : ' ';

  return (
    <Box>
      <Text backgroundColor={Colors.accent} color="black" bold>
        {title}
        {padding}
        {FEEDBACK}
      </Text>
    </Box>
  );
};
