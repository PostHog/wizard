/**
 * RevenueIntroScreen — Welcome screen for the revenue analytics flow.
 *
 * Renders one of two states:
 *   - Detection succeeded: shows detected SDKs + continue/cancel
 *   - Detection failed: shows the error + exit prompt
 *
 * Reads `frameworkContext.detectError` and `frameworkContext.detectedPosthogSdks`
 * / `detectedStripeSdks` set by detectRevenuePrerequisites().
 */

import path from 'path';
import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { PickerMenu } from '../primitives/index.js';

interface RevenueIntroScreenProps {
  store: WizardStore;
}

export const RevenueIntroScreen = ({ store }: RevenueIntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { session } = store;
  const detectError = session.frameworkContext.detectError as
    | string
    | undefined;
  const detectedPosthogSdks =
    (session.frameworkContext.detectedPosthogSdks as string[] | undefined) ??
    [];
  const detectedStripeSdks =
    (session.frameworkContext.detectedStripeSdks as string[] | undefined) ?? [];
  const detectedPackagePaths =
    (session.frameworkContext.detectedPackagePaths as string[] | undefined) ??
    [];

  if (detectError) {
    return (
      <Box
        flexDirection="column"
        flexGrow={1}
        alignItems="center"
        justifyContent="center"
      >
        <Box flexDirection="column" alignItems="center" marginBottom={1}>
          <Text bold>
            <Text color="#1D4AFF">{'\u2588'}</Text>
            <Text color="#F54E00">{'\u2588'}</Text>
            <Text color="#F9BD2B">{'\u2588'}</Text>
            {' Revenue Analytics Wizard 💸'}
          </Text>
        </Box>

        <Box flexDirection="column" marginBottom={1}>
          <Text color="red" bold>
            {'\u2718'} Cannot set up revenue analytics
          </Text>
          <Box marginTop={1} flexDirection="column">
            {detectError.split('\n').map((line, i) => (
              <Text key={i} dimColor={line.startsWith('  ')}>
                {line}
              </Text>
            ))}
          </Box>
        </Box>

        <PickerMenu
          options={[{ label: 'Exit', value: 'exit' }]}
          onSelect={() => process.exit(1)}
        />
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
    >
      <Box flexDirection="column" alignItems="center" marginBottom={1}>
        <Text bold>
          <Text color="#1D4AFF">{'\u2588'}</Text>
          <Text color="#F54E00">{'\u2588'}</Text>
          <Text color="#F9BD2B">{'\u2588'}</Text>
          {' Revenue Analytics Wizard 💸'}
        </Text>

        <Box flexDirection="column" alignItems="center" marginTop={1}>
          <Box marginTop={1}>
            <Text>Let's wire up your revenue dashboards with Stripe!</Text>
          </Box>
        </Box>
      </Box>

      <Box flexDirection="column">
        <Text>
          <Text>
            Directory <Text color="green">{'\u2714'}</Text>{' '}
          </Text>
          <Text>
            {'/'}
            {path.basename(session.installDir)}
          </Text>
        </Text>

        {detectedPosthogSdks.length > 0 && (
          <Text>
            <Text>
              PostHog <Text color="green">{'\u2714'}</Text>{' '}
            </Text>
            <Text>{detectedPosthogSdks.join(', ')} (detected)</Text>
          </Text>
        )}

        {detectedStripeSdks.length > 0 && (
          <Text>
            <Text>
              Stripe <Text color="green">{'\u2714'}</Text>{' '}
            </Text>
            <Text>{detectedStripeSdks.join(', ')} (detected)</Text>
          </Text>
        )}

        {detectedPackagePaths.length > 1 && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>
              Found in {detectedPackagePaths.length} packages:
            </Text>
            {detectedPackagePaths.map((p) => (
              <Text key={p} dimColor>
                {'  '}
                {'\u2022'} {p}
              </Text>
            ))}
          </Box>
        )}

        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>What the wizard will do next:</Text>
          <Text dimColor>
            {'\u2022'} Links Stripe customers and their purchases to PostHog
            persons
          </Text>
          <Text dimColor>
            {'\u2022'} Unlocks analytics like revenue per user, top customers,
            and lifetime value
          </Text>
        </Box>

        <Box marginTop={1}>
          <PickerMenu
            options={[
              { label: 'Continue', value: 'continue' },
              { label: 'Cancel', value: 'cancel' },
            ]}
            onSelect={(value) => {
              const choice = Array.isArray(value) ? value[0] : value;
              if (choice === 'cancel') {
                process.exit(0);
              } else {
                store.completeSetup();
              }
            }}
          />
        </Box>
      </Box>
    </Box>
  );
};
