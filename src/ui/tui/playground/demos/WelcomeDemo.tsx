/**
 * WelcomeDemo — Splash screen. Press space to push the tabbed view.
 */

import { Box, Text, useInput } from 'ink';
import type { WizardStore } from '../../store.js';
import { Colors, Icons } from '../../styles.js';

interface WelcomeDemoProps {
  store: WizardStore;
}

export const WelcomeDemo = ({ store }: WelcomeDemoProps) => {
  useInput((_input, key) => {
    if (_input === ' ') {
      store.completeSetup();
    }
  });

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      justifyContent="center"
      alignItems="center"
    >
      <Text bold color={Colors.accent}>
        {Icons.diamond} PostHog Setup Wizard layout primitives playground
      </Text>
      <Box height={1} />
      <Text>Layout primitives for the PostHog Setup Wizard TUI.</Text>
      <Text dimColor>
        CardLayout, SplitView, TabContainer, ProgressList, and more.
      </Text>
      <Box height={1} />
      <Text color={Colors.primary}>
        Press space to continue {Icons.triangleRight}
      </Text>
    </Box>
  );
};
