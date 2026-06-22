/**
 * AuthScreen — Shown while waiting for OAuth authentication.
 *
 * Displays framework detection, a compressed privacy summary, a waiting
 * spinner, and the login URL when available. [I] opens the full
 * PrivacyPanel as an overlay. [P] (when loginUrl is set) lets the user
 * paste the callback URL by hand.
 *
 * The router resolves past this screen once session.credentials is set.
 */

import { Box, Text } from 'ink';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { LoadingBox } from '@ui/tui/primitives/index';
import { PrivacyPanel } from '@ui/tui/components/PrivacyPanel';
import { IntroScreenLayout } from '@ui/tui/screens/IntroScreenLayout';
import { useKeyBindings, type KeyBinding } from '@ui/tui/hooks/useKeyBindings';
import { Colors } from '@ui/tui/styles';

interface AuthScreenProps {
  store: WizardStore;
}

export const AuthScreen = ({ store }: AuthScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [showPrivacy, setShowPrivacy] = useState(false);
  const { session } = store;

  // While the OAuth flow is waiting (loginUrl set), let the user paste the
  // callback URL/code by hand — the fallback for headless/remote shells where
  // the browser can't reach the local callback server.
  const canPasteCode = Boolean(session.loginUrl);

  // Build bindings imperatively: while the privacy view is open, the
  // screen registers NO bindings (IntroScreenLayout's menu owns input).
  const bindings: KeyBinding[] = [];
  if (!showPrivacy) {
    if (canPasteCode) {
      bindings.push({
        match: ['p', 'P'],
        label: 'P',
        action: 'paste auth code',
        handler: () => store.showManualAuthCode(),
      });
    }
    bindings.push({
      match: ['i', 'I'],
      label: 'I',
      action: 'privacy info',
      handler: () => setShowPrivacy(true),
    });
  }
  useKeyBindings('auth', bindings);

  if (showPrivacy) {
    return (
      <IntroScreenLayout
        installDir={session.installDir}
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

  const config = session.frameworkConfig;
  const frameworkLabel =
    session.detectedFrameworkLabel ?? config?.metadata.name;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.accent}>
          PostHog Setup Wizard
        </Text>

        {frameworkLabel && (
          <Text>
            <Text color="green">{'✔'} </Text>
            <Text>Framework: {frameworkLabel}</Text>
          </Text>
        )}

        {/* Dead path today — every framework went GA, so no config has
            metadata.beta = true. Kept intentionally for the next time we
            ship a framework integration in beta. Set `beta: true` on the
            framework's config and this rendering re-activates. */}
        {config?.metadata.beta && (
          <Text color="yellow">
            [BETA] The {config.metadata.name} wizard is in beta. Questions or
            feedback? Email wizard@posthog.com
          </Text>
        )}

        {config?.metadata.preRunNotice && (
          <Text color="yellow">{config.metadata.preRunNotice}</Text>
        )}
      </Box>

      <Box marginBottom={1}>
        <Text bold>
          This wizard uses AI (Anthropic's Claude) to read and modify your code.
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold dimColor>
          How does the wizard use your data?
        </Text>
        <Text dimColor>
          {'•'} Source files are read by Claude for AI context
        </Text>
        <Text dimColor>{'•'} .env* and secrets stay on your machine</Text>
        <Text dimColor>
          {'•'} Press <Text color={Colors.accent}>[I]</Text> for full privacy &
          usage info
        </Text>
      </Box>

      <LoadingBox message="Waiting for authentication..." />

      {session.loginUrl && (
        <Box marginTop={1} marginBottom={1} flexDirection="column">
          {/* Literal \n — sibling <Box> spacers squeeze to 0 under flex
              height pressure, letting cmd-click slurp /authorize + 'y'. */}
          <Text>
            <Text dimColor>
              If the browser didn't open, copy and paste this URL:
            </Text>
            {'\n\n'}
            <Text color="cyan">{session.loginUrl}</Text>
          </Text>
          <Box marginTop={1}>
            <Text dimColor>
              On a remote machine or devbox? Press{' '}
              <Text color={Colors.accent}>[P]</Text> to paste the callback URL.
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
