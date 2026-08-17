/**
 * SelfDrivingIntegrationCheckScreen — shown only when detection found no
 * PostHog in the project. Self-driving needs a PostHog SDK, so we always
 * integrate first; but a project with no SDK is often a project with no PostHog
 * account either, so this screen first asks whether the user already has one:
 *
 *   - "Yes — log me in"        → setIntegrate(true); auth runs the OAuth login.
 *   - "No — create one for me" → collect email + region, then
 *                                chooseProvisionAccount(): auth provisions a new
 *                                account (and emails a login link) instead.
 *
 * Both answers integrate the SDK; they only differ in how auth gets credentials.
 * Skipped entirely when PostHog is already present (or under `--integrate`,
 * which forces integration + the default OAuth login).
 */

import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { useState, useSyncExternalStore } from 'react';

import type { WizardStore } from '@ui/tui/store';
import type { CloudRegion } from '@lib/wizard-session';
import { PickerMenu } from '@ui/tui/primitives/index';
import { PrivacyPanel } from '@ui/tui/components/PrivacyPanel';
import { IntroScreenLayout } from '@ui/tui/screens/IntroScreenLayout';
import { POSTHOG_PRIVACY_URL, POSTHOG_TERMS_URL } from '@lib/constants';
import { Colors } from '@ui/tui/styles';

interface SelfDrivingIntegrationCheckScreenProps {
  store: WizardStore;
}

/** Multi-step screen state: pick account status → email → region. */
type Stage = 'ask' | 'email' | 'region';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const SelfDrivingIntegrationCheckScreen = ({
  store,
}: SelfDrivingIntegrationCheckScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [stage, setStage] = useState<Stage>('ask');
  // Pre-fill from `--email` when it was passed; tracked across stages so
  // the region step can hand both to the store in one commit.
  const [email, setEmail] = useState(store.session.email ?? '');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [showPrivacy, setShowPrivacy] = useState(false);

  useInput((input, key) => {
    // While the privacy overlay is open, only Esc closes it; the overlay's own
    // Back menu handles the rest.
    if (showPrivacy) {
      if (key.escape) setShowPrivacy(false);
      return;
    }

    // [I] opens the full privacy panel. Skipped on the email stage so the
    // keystroke reaches the text field instead.
    if ((input === 'i' || input === 'I') && stage !== 'email') {
      setShowPrivacy(true);
      return;
    }

    // Esc steps back toward the account question (the picker owns input on 'ask').
    if (key.escape && stage !== 'ask') {
      setEmailError(null);
      setStage(stage === 'region' ? 'email' : 'ask');
    }
  });

  if (showPrivacy) {
    return (
      <IntroScreenLayout
        installDir={store.session.installDir}
        title="Wizard privacy & usage"
        showSubtitle={false}
        showDetection={false}
        body={<PrivacyPanel />}
        menuOptions={[{ label: 'Back', value: 'back' }]}
        menuAlign="left"
        onSelect={() => setShowPrivacy(false)}
      />
    );
  }

  if (stage === 'region') {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text bold color={Colors.accent}>
          Where should we create your account?
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            We&apos;ll create your PostHog account for {email} in this region.
          </Text>
        </Box>
        <Box marginTop={1}>
          <PickerMenu
            message="Pick your cloud region"
            options={[
              { label: 'US', value: 'us', hint: 'us.posthog.com' },
              { label: 'EU', value: 'eu', hint: 'eu.posthog.com' },
            ]}
            onSelect={(value) => {
              const region = (
                Array.isArray(value) ? value[0] : value
              ) as CloudRegion;
              store.chooseProvisionAccount(email.trim(), region);
            }}
          />
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>By creating an account you agree to our terms.</Text>
          <Text dimColor>
            Terms: <Text color="cyan">{POSTHOG_TERMS_URL}</Text>
          </Text>
          <Text dimColor>
            Privacy: <Text color="cyan">{POSTHOG_PRIVACY_URL}</Text>
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            <Text color={Colors.accent}>[Esc]</Text> back{'  ·  '}
            <Text color={Colors.accent}>[I]</Text> privacy & usage
          </Text>
        </Box>
      </Box>
    );
  }

  if (stage === 'email') {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text bold color={Colors.accent}>
          Create your PostHog account
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            We&apos;ll create your account and email you a login link. What
            email should we use?
          </Text>
        </Box>
        <Box marginTop={1} width="100%">
          <TextInput
            placeholder="you@company.com"
            defaultValue={email}
            onChange={setEmail}
            onSubmit={(value) => {
              const trimmed = value.trim();
              if (!EMAIL_RE.test(trimmed)) {
                setEmailError('Please enter a valid email address.');
                return;
              }
              setEmail(trimmed);
              setEmailError(null);
              setStage('region');
            }}
          />
        </Box>
        {emailError && (
          <Box marginTop={1}>
            <Text color="yellow">{emailError}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>
            <Text color={Colors.accent}>[Enter]</Text> continue{'  ·  '}
            <Text color={Colors.accent}>[Esc]</Text> back
          </Text>
        </Box>
      </Box>
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
              label: 'No, create one for me',
              value: 'provision',
              hint: "we'll email you a login link",
            },
          ]}
          onSelect={(value) => {
            const choice = Array.isArray(value) ? value[0] : value;
            if (choice === 'login') {
              store.setIntegrate(true);
            } else {
              setStage('email');
            }
          }}
        />
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          <Text color={Colors.accent}>[I]</Text> privacy & usage
        </Text>
      </Box>
    </Box>
  );
};
