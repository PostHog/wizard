import { Box, Text } from 'ink';
import type { WizardStore } from '../store.js';

interface IntroViewProps {
  store: WizardStore;
}

export const IntroView = ({ store }: IntroViewProps) => {
  const {
    wizardLabel,
    detectedFramework,
    betaNotice,
    preRunNotice,
    disclosure,
  } = store;

  // Nothing to show yet
  if (!wizardLabel && !detectedFramework && !disclosure) {
    return null;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      {wizardLabel && (
        <Text bold color="yellow">
          {wizardLabel}
        </Text>
      )}

      {detectedFramework && (
        <Text>
          <Text color="green">{'\u2714'}</Text>
          {'  '}Detected framework: <Text bold>{detectedFramework}</Text>
        </Text>
      )}

      {betaNotice && <Text color="yellow">{betaNotice}</Text>}

      {preRunNotice && (
        <Text color="yellow">
          {'\u26A0'} {preRunNotice}
        </Text>
      )}

      {disclosure && (
        <Box marginTop={1} flexDirection="column">
          {disclosure.split('\n').map((line, i) => (
            <Text key={i} dimColor>
              {line}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
};
