import { Box, Text } from 'ink';
import { Colors } from '../styles.js';
import type { AgentProvider } from '../../../lib/wizard-session.js';

const FEEDBACK = 'Feedback: wizard@posthog.com ';
const FEEDBACK_SHORT = ' wizard@posthog.com ';

interface TitleBarProps {
  version: string;
  width: number;
  provider: AgentProvider;
}

export const TitleBar = ({ version, width, provider }: TitleBarProps) => {
  const providerLabel = provider === 'openai' ? 'OpenAI' : 'Claude';
  const fullTitle = ` PostHog Wizard v${version} · ${providerLabel}`;
  const needShort = width < fullTitle.length + FEEDBACK.length;
  const feedback = needShort ? FEEDBACK_SHORT : FEEDBACK;
  const title =
    needShort && fullTitle.length + feedback.length > width
      ? ` Wizard v${version} · ${providerLabel}`
      : fullTitle;
  const gap = Math.max(0, width - title.length - feedback.length);
  const padding = ' '.repeat(gap);

  return (
    <Box width={width} overflow="hidden">
      <Text backgroundColor={Colors.accent} color="black" bold>
        {title}
        {padding}
        {feedback}
      </Text>
    </Box>
  );
};
