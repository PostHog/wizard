/**
 * HowItWorksTab — Static explainer content about the PostHog wizard.
 */

import { Box, Text } from 'ink';

interface HowItWorksTabProps {
  store: unknown; // Receives store prop for consistency but doesn't use it
}

export const HowItWorksTab = (_props: HowItWorksTabProps) => {
  return (
    <Box flexDirection="column" paddingX={1} gap={1}>
      <Text bold color="yellow">
        How the PostHog Wizard Works
      </Text>

      <Box flexDirection="column">
        <Text bold>1. Authentication</Text>
        <Text dimColor>
          {'   '}The wizard authenticates with your PostHog instance via OAuth.
        </Text>
      </Box>

      <Box flexDirection="column">
        <Text bold>2. Framework Detection</Text>
        <Text dimColor>
          {'   '}Your project is scanned to detect the framework, package
          manager, and existing configuration.
        </Text>
      </Box>

      <Box flexDirection="column">
        <Text bold>3. AI-Powered Integration</Text>
        <Text dimColor>
          {'   '}An AI agent reads PostHog integration docs and writes the code
          changes needed for your specific setup.
        </Text>
      </Box>

      <Box flexDirection="column">
        <Text bold>4. Verification</Text>
        <Text dimColor>
          {'   '}The agent verifies the integration compiles and runs correctly.
        </Text>
      </Box>

      <Box flexDirection="column">
        <Text color="gray">Learn more: https://posthog.com/docs</Text>
      </Box>
    </Box>
  );
};
