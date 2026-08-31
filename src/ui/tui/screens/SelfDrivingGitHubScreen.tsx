/**
 * SelfDrivingGitHubScreen — the "Connect GitHub" gate, shown after the handoff
 * and before the Self-driving run.
 *
 * Self-driving cannot research findings or open fixes without code access, so
 * the GitHub App is a hard requirement. The agent used to ask for it mid-run
 * via `wizard_ask` and abort when the answer came back declined — but a
 * `wizard_ask` timeout resolves to the same cancelled value as a real decline,
 * so a user who stepped away had their run killed as if they had refused.
 * Gating here instead makes the requirement cheap (no agent has started),
 * unambiguous (declining is an explicit pick), and un-timeoutable (the screen
 * waits as long as the browser install takes).
 *
 * Mirrors SlackConnectScreen's shape: open the authorize link, poll
 * `/integrations/` until GitHub appears, flip the screen when it does. Unlike
 * Slack this is not skippable — the second option ends the run on the outro
 * rather than continuing without it.
 */

import { Box, Text } from 'ink';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { WizardStore } from '@ui/tui/store';
import { Colors, Icons } from '@ui/tui/styles';
import { PickerMenu, LoadingBox } from '@ui/tui/primitives/index';
import { useKeyBindings, KeyMatch } from '@ui/tui/hooks/useKeyBindings';
import { fetchGithubConnected } from '@lib/api';
import { OutroKind } from '@lib/wizard-session';
import {
  GITHUB_REQUIRED_BODY,
  GITHUB_REQUIRED_MESSAGE,
} from '@lib/programs/self-driving/detect';
import { analytics } from '@utils/analytics';
import { openTrackedLink } from '@utils/links';

interface SelfDrivingGitHubScreenProps {
  store: WizardStore;
}

enum ChoiceValue {
  Open = 'open',
  Decline = 'decline',
}

const POLL_INTERVAL_MS = 3000;

/**
 * One-click GitHub App install for this project. Opening it in the user's
 * logged-in browser runs the install directly — no settings-page hunting.
 */
export const githubAuthorizeUrl = (
  appHost: string,
  projectId: number,
): string =>
  `${appHost.replace(
    /\/$/,
    '',
  )}/api/environments/${projectId}/integrations/authorize?kind=github`;

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
    ? githubAuthorizeUrl(credentials.host.appHost, credentials.projectId)
    : null;

  // Once the install link has been opened, re-offering it as the headline CTA
  // is confusing — the poll flips the screen on its own when the install lands.
  const [installOpened, setInstallOpened] = useState(false);

  // Impression fires once the connected state is known, so `already_connected`
  // is real: users who arrive connected segment apart from users who connect
  // during the screen.
  const known = connectedState !== null;
  const impressionFired = useRef(false);
  useEffect(() => {
    if (!known || impressionFired.current) return;
    impressionFired.current = true;
    analytics.wizardCapture('github connect shown', {
      already_connected: connected,
    });
  }, [known, connected]);

  // Installing the App is a manual browser step, so the poll is what flips the
  // screen once the user comes back. The first tick also resolves the
  // null/unknown state.
  useEffect(() => {
    if (!credentials || connected) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const check = (): void => {
      fetchGithubConnected(
        credentials.accessToken,
        credentials.projectId,
        credentials.host.apiHost,
        controller.signal,
      )
        .then((isConnected) => {
          if (cancelled) return;
          if (isConnected) {
            // Only a false→true flip means the user installed during this
            // screen; true on the first check means they arrived connected.
            if (store.session.githubConnected === false) {
              analytics.wizardCapture('github connect completed');
            }
            store.setGithubConnected(true);
            return;
          }
          if (store.session.githubConnected === null) {
            store.setGithubConnected(false);
          }
          timer = setTimeout(check, POLL_INTERVAL_MS);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          // Capture once and keep polling: unlike Slack, a failed check can't
          // fall back to a nudge — the run cannot proceed until this resolves,
          // so a transient API blip must not strand the user on a dead screen.
          if (store.session.githubConnected === null) {
            store.setGithubConnected(false);
            analytics.captureException(
              err instanceof Error ? err : new Error(String(err)),
              { step: 'github_connected_check' },
            );
          }
          timer = setTimeout(check, POLL_INTERVAL_MS);
        });
    };
    check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      controller.abort();
    };
  }, [credentials, connected, store]);

  const openInstall = (): void => {
    if (!authorizeUrl) return;
    analytics.wizardCapture('github connect opened');
    openTrackedLink(authorizeUrl, 'self-driving-github-connect');
    setInstallOpened(true);
  };

  // Declining ends the run here, before the agent starts. The outro carries the
  // same copy the abort case renders, so both paths read identically.
  const decline = (): void => {
    analytics.wizardCapture('github connect declined', {
      install_opened: installOpened,
    });
    store.declineGithub({
      kind: OutroKind.Cancel,
      message: GITHUB_REQUIRED_MESSAGE,
      body: GITHUB_REQUIRED_BODY,
    });
  };

  const handleSelect = (value: ChoiceValue | ChoiceValue[]): void => {
    const choice = Array.isArray(value) ? value[0] : value;
    if (choice === ChoiceValue.Open) {
      openInstall();
      return;
    }
    decline();
  };

  useKeyBindings('self-driving-github', [
    {
      match: KeyMatch.Escape,
      label: 'esc',
      action: connected ? 'continue' : 'end setup',
      handler: () => {
        if (connected) return;
        decline();
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
              : 'Self-driving needs GitHub access to research findings in your code and open fixes, so setup cannot finish without it.'}
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
            options={
              installOpened
                ? [
                    {
                      label: 'Re-open GitHub App install',
                      value: ChoiceValue.Open,
                    },
                    {
                      label: "I can't connect right now",
                      value: ChoiceValue.Decline,
                    },
                  ]
                : [
                    {
                      label: 'Open GitHub App install',
                      value: ChoiceValue.Open,
                    },
                    {
                      label: "I can't connect right now",
                      value: ChoiceValue.Decline,
                    },
                  ]
            }
            onSelect={handleSelect}
          />
        </Box>
      </Box>
    </Box>
  );
};
