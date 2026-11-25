/**
 * SelfDrivingIntegrationCheckScreen: shown only when detection found no
 * PostHog in the project. Self-driving needs a PostHog SDK, so the run
 * integrates first. "Continue" calls setIntegrate(true), and auth then opens
 * PostHog's login, which also lets a person without an account sign up.
 *
 * Skipped entirely when PostHog is already present (or under `--integrate`,
 * which forces integration + the default OAuth login).
 */

import { Box, Text, useInput } from 'ink';
import { useState, useSyncExternalStore } from 'react';

import type { WizardStore } from '@tui/store';
import { PickerMenu } from '@tui/primitives/index';
import {
  PrivacyPanel,
  PRIVACY_PANEL_LABEL,
} from '@tui/components/PrivacyPanel';
import { IntroScreenLayout } from '@tui/screens/IntroScreenLayout';
import { Colors } from '@tui/styles';

interface SelfDrivingIntegrationCheckScreenProps {
  store: WizardStore;
}

export const SelfDrivingIntegrationCheckScreen = ({
  store,
}: SelfDrivingIntegrationCheckScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [showPrivacy, setShowPrivacy] = useState(false);

  useInput((input, key) => {
    // While the privacy overlay is open, only Esc closes it; the overlay's own
    // Back menu handles the rest.
    if (showPrivacy) {
      if (key.escape) setShowPrivacy(false);
      return;
    }

    // [I] opens the full privacy panel.
    if (input === 'i' || input === 'I') {
      setShowPrivacy(true);
    }
  });

  if (showPrivacy) {
    return (
      <IntroScreenLayout
        installDir={store.session.installDir}
        title={PRIVACY_PANEL_LABEL}
        showSubtitle={false}
        showDetection={false}
        body={<PrivacyPanel />}
        showPrivacy={false}
        menuOptions={[{ label: 'Back', value: 'back' }]}
        menuAlign="left"
        onSelect={() => setShowPrivacy(false)}
      />
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        No PostHog integration found
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          Self-driving reads PostHog data, so the setup agent adds PostHog to
          your project first. That gives your signal sources something to watch.
          PostHog opens in your browser next: log in, or create an account if
          you don&apos;t have one.
        </Text>
      </Box>

      <Box marginTop={1}>
        <PickerMenu
          options={[
            {
              label: 'Continue',
              value: 'continue',
              hint: 'opens PostHog to log in or sign up',
            },
          ]}
          onSelect={() => store.setIntegrate(true)}
        />
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          <Text color={Colors.accent}>[I]</Text> {PRIVACY_PANEL_LABEL}
        </Text>
      </Box>
    </Box>
  );
};
