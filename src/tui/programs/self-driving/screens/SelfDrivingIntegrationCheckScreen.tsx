/**
 * SelfDrivingIntegrationCheckScreen — shown only when detection found no
 * PostHog in the project. Self-driving needs a PostHog SDK, so we always
 * integrate first; but a project with no SDK is often a project with no PostHog
 * account either, so this screen first asks whether the user already has one:
 *
 *   - "Yes, log me in"         → setIntegrate(true); auth opens the login.
 *   - "No, sign me up"         → chooseSignup(); auth opens PostHog's sign-up
 *                                in the browser, then the consent screen.
 *
 * Both answers integrate the SDK; they only differ in which page auth opens.
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
          This will kick off an agent to explore your project and find existing
          PostHog integrations. Self-driving reads PostHog data, so we&apos;ll
          set that up first: it gives your signal sources something to watch. To
          do that we need to connect to PostHog — do you already have an
          account?
        </Text>
      </Box>

      <Box marginTop={1}>
        <PickerMenu
          options={[
            {
              label: 'Yes, log me in',
              value: 'login',
              hint: 'opens PostHog to authorize',
            },
            {
              label: 'No, sign me up',
              value: 'signup',
              hint: 'opens PostHog to sign up',
            },
          ]}
          onSelect={(value) => {
            const choice = Array.isArray(value) ? value[0] : value;
            if (choice === 'login') {
              store.setIntegrate(true);
            } else {
              store.chooseSignup();
            }
          }}
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
