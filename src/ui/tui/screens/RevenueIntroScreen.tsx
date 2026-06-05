/**
 * RevenueIntroScreen — Welcome screen for the revenue analytics flow.
 *
 * Composes IntroScreenLayout with SDK-detection-specific state:
 *   - Detection succeeded: shows detected PostHog + Stripe SDKs, continue/cancel
 *   - Detection failed: shows the error via errorView + exit prompt
 *
 * Reads `frameworkContext.detectError` and `frameworkContext.detectedPosthogSdks`
 * / `detectedStripeSdks` set by detectRevenuePrerequisites().
 */

import { Box, Text } from 'ink';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { PickerMenu } from '@ui/tui/primitives/index';
import { IntroScreenLayout, type DetectionRow } from './IntroScreenLayout.js';
import {
  POSTHOG_SDKS,
  STRIPE_SDKS,
  type RevenueDetectError,
} from '@lib/programs/revenue-analytics/index';

interface RevenueIntroScreenProps {
  store: WizardStore;
}

export const RevenueIntroScreen = ({ store }: RevenueIntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [showingMoreInfo, setShowingMoreInfo] = useState(false);

  const { session } = store;
  const detectError = session.frameworkContext.detectError as
    | RevenueDetectError
    | undefined;
  const detectedPosthogSdks =
    (session.frameworkContext.detectedPosthogSdks as string[] | undefined) ??
    [];
  const detectedStripeSdks =
    (session.frameworkContext.detectedStripeSdks as string[] | undefined) ?? [];
  const detectedPackagePaths =
    (session.frameworkContext.detectedPackagePaths as string[] | undefined) ??
    [];

  // ── Detection rows ─────────────────────────────────────────────────

  const detectionRows: DetectionRow[] = [];
  if (detectedPosthogSdks.length > 0) {
    detectionRows.push({
      label: 'PostHog SDK',
      value: detectedPosthogSdks.join(', '),
    });
  }
  if (detectedStripeSdks.length > 0) {
    detectionRows.push({
      label: 'Stripe SDK',
      value: detectedStripeSdks.join(', '),
    });
  }

  // ── Body ────────────────────────────────────────────────────────────

  const body = showingMoreInfo ? (
    <Box flexDirection="column" width={56} flexShrink={0}>
      <Text>
        The wizard is an agent that executes PostHog tasks. Its code is open
        source: <Text color="cyan">https://github.com/PostHog/wizard</Text>.
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Text>
          The{' '}
          <Text italic color="cyan">
            {session.programLabel}
          </Text>{' '}
          program links Stripe customers and purchases to PostHog product data
          and persons. It unlocks insights like:
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1} paddingLeft={4}>
        <Text>{'\u2022'} Revenue per user</Text>
        <Text>{'\u2022'} Lifetime value</Text>
        <Text>{'\u2022'} MRR / churn tracking</Text>
      </Box>
    </Box>
  ) : (
    <>
      <Box flexDirection="column" alignItems="center">
        <Text>Let's create revenue analytics with Stripe and PostHog.</Text>
        <Box flexDirection="column" marginTop={1}>
          <Text>Link purchases to product data.</Text>
        </Box>
      </Box>

      {detectedPackagePaths.length > 1 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Found in {detectedPackagePaths.length} packages:</Text>
          {detectedPackagePaths.map((p) => (
            <Text key={p} dimColor>
              {'  '}
              {'\u2022'} {p}
            </Text>
          ))}
        </Box>
      )}
    </>
  );

  // ── Error view ─────────────────────────────────────────────────────

  const errorView = detectError ? (
    <>
      <Box flexDirection="column" marginBottom={1}>
        <Text color="red" bold>
          {'\u2718'} Cannot set up revenue analytics
        </Text>
        <Box marginTop={1} flexDirection="column">
          <DetectErrorBody error={detectError} />
        </Box>
      </Box>

      <PickerMenu
        options={[{ label: 'Exit', value: 'exit' }]}
        onSelect={() => process.exit(1)}
      />
    </>
  ) : undefined;

  // ── Menu ───────────────────────────────────────────────────────────
  const menuOptions = showingMoreInfo
    ? [{ label: 'Back', value: 'back' }]
    : [
        { label: 'Continue', value: 'continue' },
        { label: 'More info', value: 'more-info' },
        { label: 'Cancel', value: 'cancel' },
      ];
  // ── Render ─────────────────────────────────────────────────────────

  return (
    <IntroScreenLayout
      installDir={session.installDir}
      showSubtitle={!showingMoreInfo}
      body={body}
      showDetection={!showingMoreInfo}
      detectionRows={detectionRows}
      errorView={errorView}
      programLabel={session.programLabel}
      skillId={session.skillId}
      menuOptions={menuOptions}
      onSelect={(value) => {
        if (value === 'cancel') {
          process.exit(0);
        } else if (value === 'more-info') {
          setShowingMoreInfo(true);
        } else if (value === 'back') {
          setShowingMoreInfo(false);
        } else {
          store.completeSetup();
        }
      }}
    />
  );
};

const DetectErrorBody = ({ error }: { error: RevenueDetectError }) => {
  switch (error.kind) {
    case 'bad-directory': {
      const reasonText = {
        missing: 'does not exist',
        'not-dir': 'is not a directory',
        unreadable: 'could not be accessed',
      }[error.reason];
      return (
        <>
          <Text>This path {reasonText}:</Text>
          <Text dimColor>
            {'  '}
            {error.path}
          </Text>
        </>
      );
    }

    case 'no-package-json':
      return (
        <>
          <Text>No package.json found in this directory.</Text>
          <Text dimColor>
            Revenue analytics currently supports Node.js / TypeScript projects.
          </Text>
          <Text dimColor>Run this command from your project root.</Text>
        </>
      );

    case 'no-sdks':
      return (
        <>
          <Text>
            Neither PostHog nor Stripe SDKs detected (scanned{' '}
            {error.scannedCount} package.json file
            {error.scannedCount === 1 ? '' : 's'}).
          </Text>
          <Box marginTop={1} flexDirection="column">
            <Text>Revenue analytics requires:</Text>
            <Text dimColor>
              {'  \u2022'} A PostHog SDK ({POSTHOG_SDKS.slice(0, 3).join(', ')},
              …)
            </Text>
            <Text dimColor>
              {'  \u2022'} A Stripe SDK ({STRIPE_SDKS.join(', ')})
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              Install Stripe and run <Text bold>npx @posthog/wizard</Text> to
              set up PostHog.
            </Text>
          </Box>
        </>
      );

    case 'missing-posthog':
      return (
        <>
          <Text>
            Found Stripe ({error.foundStripe.join(', ')}) but no PostHog SDK.
          </Text>
          <Box marginTop={1}>
            <Text dimColor>
              Run <Text bold>npx @posthog/wizard</Text> first to set up the base
              PostHog integration.
            </Text>
          </Box>
        </>
      );

    case 'missing-stripe':
      return (
        <>
          <Text>
            Found PostHog ({error.foundPosthog.join(', ')}) but no Stripe SDK.
          </Text>
          <Text dimColor>
            Revenue analytics currently supports Stripe only.
          </Text>
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Install one of:</Text>
            {STRIPE_SDKS.map((sdk) => (
              <Text key={sdk} dimColor>
                {'  \u2022'} {sdk}
              </Text>
            ))}
          </Box>
        </>
      );
  }
};
