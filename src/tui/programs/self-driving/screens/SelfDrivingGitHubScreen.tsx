/**
 * SelfDrivingGitHubScreen — the "Connect GitHub" gate, shown after the handoff
 * and before the Self-driving run.
 *
 * Self-driving needs code access to research findings and open fixes. The
 * agent used to ask for the GitHub App mid-run via `wizard_ask` — but a
 * `wizard_ask` timeout resolves to the same cancelled value as a real decline,
 * so a user who stepped away was read as refusing. Asking here instead is
 * unambiguous (skipping is an explicit pick) and un-timeoutable (the screen
 * waits as long as the browser install takes).
 *
 * Like SlackConnectScreen this is skippable: skipping starts the run without
 * GitHub, and the prompt tells the agent to leave it out. The connection poll
 * lives in {@link useGithubConnection}.
 */

import { Box, Text } from 'ink';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { WizardStore } from '@tui/store';
import { Colors, Icons } from '@tui/styles';
import { PickerMenu, LoadingBox } from '@tui/primitives/index';
import { useKeyBindings, KeyMatch } from '@tui/hooks/useKeyBindings';
import {
  useGithubConnection,
  fetchLoginUrl,
} from '@tui/programs/self-driving/hooks/useGithubConnection';
import { analytics } from '@utils/analytics';
import { openTrackedLink } from '@utils/links';
import { getIntegrationAuthorizeUrl } from '@utils/urls';

interface SelfDrivingGitHubScreenProps {
  store: WizardStore;
}

enum ChoiceValue {
  Open = 'open',
  Skip = 'skip',
}

export const SelfDrivingGitHubScreen = ({
  store,
}: SelfDrivingGitHubScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const credentials = store.session.credentials;
  const connectedState = store.session.githubConnected;
  const connected = connectedState === true;

  const authorizeUrl = credentials
    ? getIntegrationAuthorizeUrl(
        credentials.host.appHost,
        credentials.projectId,
        'github',
      )
    : null;

  useGithubConnection(store);

  // Once the install link has been opened, re-offering it as the headline CTA
  // is confusing — the poll flips the screen on its own when the install lands.
  const [installOpened, setInstallOpened] = useState(false);

  // One-time login link for browsers without a PostHog session (fresh provisioned accounts).
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const loginUrlRequested = useRef(false);
  useEffect(() => {
    if (loginUrlRequested.current) return;
    loginUrlRequested.current = true;
    void fetchLoginUrl(store.session).then(setLoginUrl);
  }, [store]);

  // Impression fires once the connected state is known, so `already_connected`
  // is real: users who arrive connected segment apart from users who connect
  // during the screen.
  const impressionFired = useRef(false);
  useEffect(() => {
    if (connectedState === null || impressionFired.current) return;
    impressionFired.current = true;
    analytics.wizardCapture('github connect shown', {
      already_connected: connected,
    });
  }, [connectedState, connected]);

  const openInstall = (): void => {
    if (!authorizeUrl) return;
    analytics.wizardCapture('github connect opened');
    openTrackedLink(authorizeUrl, 'self-driving-github-connect');
    setInstallOpened(true);
  };

  const skip = (): void => {
    analytics.wizardCapture('github connect skipped', {
      install_opened: installOpened,
    });
    store.skipGithub();
  };

  const handleSelect = (value: ChoiceValue | ChoiceValue[]): void => {
    const choice = Array.isArray(value) ? value[0] : value;
    if (choice === ChoiceValue.Open) openInstall();
    else skip();
  };

  useKeyBindings('self-driving-github', [
    {
      match: KeyMatch.Escape,
      label: 'esc',
      action: connected ? 'continue' : 'skip',
      handler: () => {
        if (!connected) skip();
      },
    },
  ]);

  if (credentials && connectedState === null) {
    return (
      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        <LoadingBox message="Checking for an existing GitHub connection..." />
      </Box>
    );
  }

  if (connected) {
    return (
      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        <Text bold color={Colors.success}>
          {Icons.check} GitHub connected
        </Text>
        <Box marginTop={1}>
          <Text>
            Self-driving can research findings in your code and open fixes.
          </Text>
        </Box>
        <Box marginTop={1}>
          <LoadingBox message="Starting Self-driving setup..." />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginTop={1} flexDirection="column">
        <Text bold color={Colors.accent}>
          {installOpened ? 'Finish connecting GitHub' : 'Connect GitHub'}
        </Text>

        <Box marginTop={1}>
          <Text>
            {installOpened
              ? "We've opened the PostHog GitHub App install in your browser. Approve access there — we'll detect it automatically and continue."
              : 'Self-driving uses GitHub access to research findings in your code and open fixes. You can skip this and connect it later from your integrations settings.'}
          </Text>
        </Box>

        {!installOpened && (
          <Box marginTop={1}>
            <Text>
              <Text color="cyan">{Icons.diamond} </Text>
              Grant it the repos you want Self-driving to work with — include
              this project&apos;s repo so it can also watch its issues.
            </Text>
          </Box>
        )}

        {loginUrl && (
          <Box marginTop={1}>
            <Text dimColor>
              {'Log in to your new account first: '}
              <Text color="cyan">{loginUrl}</Text>
            </Text>
          </Box>
        )}

        {authorizeUrl && (
          <Box marginTop={1}>
            <Text dimColor>
              {installOpened ? 'Install page: ' : 'Install it: '}
              <Text color="cyan">{authorizeUrl}</Text>
            </Text>
          </Box>
        )}

        <Box marginTop={1}>
          <PickerMenu
            options={[
              {
                label: installOpened
                  ? 'Re-open GitHub App install'
                  : 'Open GitHub App install',
                value: ChoiceValue.Open,
              },
              {
                label: 'Skip for now',
                value: ChoiceValue.Skip,
              },
            ]}
            onSelect={handleSelect}
          />
        </Box>
      </Box>
    </Box>
  );
};
