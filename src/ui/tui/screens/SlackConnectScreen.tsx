/**
 * SlackConnectScreen — the dedicated "Connect Slack" step shown after the
 * MCP tutorial (`wizard mcp tutorial`), after a successful install
 * (`wizard mcp add`), at the end of the integration flow, and as the whole
 * program in the standalone `wizard slack` flow.
 *
 * Presents the PostHog Slack app plus role-tailored use-cases. The copy
 * adapts to whether Slack is already connected (polled while the screen
 * is up, held as local state):
 *   • not connected (or unknown) — nudge + "Open Slack setup", which
 *     launches the browser at the integration settings page and keeps
 *     the screen alive; the poll flips it to connected once the user
 *     finishes the manual OAuth step in the browser.
 *   • already connected — confirm it and skip the connect CTA, so users
 *     who already have it aren't nagged.
 * "Skip" / "Done" / esc dismiss the step (`slackStepDismissed`) and let
 * the router advance to exit.
 *
 * The mcp and integration flows arrive here already authenticated. In the
 * standalone `wizard slack` flow the program's `onInit` runs the OAuth
 * while this screen renders the auth-wait state.
 */

import { Box, Text } from 'ink';
import { useEffect, useRef, useSyncExternalStore } from 'react';

import type { WizardStore } from '@ui/tui/store';
import { Colors, Icons } from '@ui/tui/styles';
import { LoadingBox, PickerMenu } from '@ui/tui/primitives/index';
import { useKeyBindings, KeyMatch } from '@ui/tui/hooks/useKeyBindings';
import { getSlackAppCard } from '@lib/mcp-role-prompts';
import { fetchSlackConnected } from '@lib/api';
import { Program } from '@lib/programs/program-registry';
import { analytics } from '@utils/analytics';
import { openTrackedLink, withUtm } from '@utils/links';

interface SlackConnectScreenProps {
  store: WizardStore;
}

enum ChoiceValue {
  Open = 'open',
  Skip = 'skip',
}

const POLL_INTERVAL_MS = 3000;

export const SlackConnectScreen = ({ store }: SlackConnectScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const role = store.session.roleAtOrganization;
  const slack = getSlackAppCard();
  const setupUrl = withUtm(slack.setupUrl, 'slack-connect-setup');
  const learnMoreUrl = withUtm(slack.learnMoreUrl, 'slack-connect-learn-more');

  const credentials = store.session.credentials;

  // Standalone, the program's onInit is mid-OAuth while credentials are
  // missing. Other flows arrive authenticated, or deliberately
  // unauthenticated (nudge without the poll).
  const awaitingLogin =
    store.router.activeProgram === Program.SlackConnect && !credentials;

  // `slackConnected` is three-state: null until something has actually
  // checked (the tutorial's prefetch, or this screen's first poll tick).
  const connectedState = store.session.slackConnected;
  const connected = connectedState === true;

  // Impression — once, and only when the connected state is known, so
  // `already_connected` is real: users who arrive connected segment apart
  // from users who connect during the screen ('slack connect completed').
  // The no-creds path can't know the state, so it fires
  // `slack connect nudge shown` instead — see below.
  const known = connectedState !== null;
  const impressionFired = useRef(false);
  useEffect(() => {
    if (!known || impressionFired.current) return;
    impressionFired.current = true;
    analytics.wizardCapture('slack connect shown', {
      role,
      already_connected: connected,
    });
  }, [known, connected, role]);

  // Separate impression for the no-creds path: we render the nudge but
  // don't know whether the user is already connected. Lets funnel
  // readers see those impressions distinctly from authenticated views.
  const nudgeImpressionFired = useRef(false);
  useEffect(() => {
    if (credentials || awaitingLogin || nudgeImpressionFired.current) return;
    nudgeImpressionFired.current = true;
    analytics.wizardCapture('slack connect nudge shown', { role });
  }, [credentials, awaitingLogin, role]);

  // While not connected, poll: connecting Slack is a manual OAuth step in
  // the browser, so the poll is what flips the screen to the connected
  // state when the user comes back. The first tick also resolves the
  // null/unknown state. Without credentials (user skipped login) it
  // renders the connect nudge.
  useEffect(() => {
    if (!credentials || connected) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const check = (): void => {
      fetchSlackConnected(
        credentials.accessToken,
        credentials.projectId,
        credentials.host,
        controller.signal,
      )
        .then((isConnected) => {
          if (cancelled) return;
          if (isConnected) {
            // Only a false→true flip means the user completed the Slack
            // OAuth during this screen; true on the first-ever check just
            // means they arrived connected.
            if (store.session.slackConnected === false) {
              analytics.wizardCapture('slack connect completed', { role });
            }
            store.setSlackConnected(true);
          } else {
            if (store.session.slackConnected === null) {
              store.setSlackConnected(false);
            }
            timer = setTimeout(check, POLL_INTERVAL_MS);
          }
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          // Capture once and stop polling — repeating a failing call
          // every tick would spam error tracking. The nudge copy is
          // the fallback either way; a failed check counts as not
          // connected so the screen doesn't sit on the loading state.
          if (store.session.slackConnected === null) {
            store.setSlackConnected(false);
          }
          analytics.captureException(
            err instanceof Error ? err : new Error(String(err)),
            { step: 'slack_connected_check' },
          );
        });
    };
    check();
    return () => {
      // Tear down fully on exit: no new ticks (cancelled), no pending
      // tick (clearTimeout), no in-flight request (abort).
      cancelled = true;
      if (timer) clearTimeout(timer);
      controller.abort();
    };
  }, [credentials, connected, store]);

  // Leaving while connected is "done"; leaving while not connected is a
  // skip. Two events so the funnel reads without prop gymnastics. The
  // `connection_state` property on `skipped` distinguishes "we knew the
  // user wasn't connected" (had creds, polled, false) from "we never
  // knew" (no creds, never polled).
  const dismiss = (): void => {
    if (connected) {
      analytics.wizardCapture('slack connect done', { role });
    } else {
      analytics.wizardCapture('slack connect skipped', {
        role,
        connection_state: credentials ? 'not_connected' : 'unknown',
      });
    }
    store.setSlackStepDismissed();
  };

  const handleSelect = (value: ChoiceValue | ChoiceValue[]): void => {
    const choice = Array.isArray(value) ? value[0] : value;
    if (choice === ChoiceValue.Open) {
      analytics.wizardCapture('slack connect opened', { role });
      // The screen stays up; the poll flips it to connected once the
      // OAuth step completes in the browser.
      openTrackedLink(setupUrl, 'slack-connect-setup');
      return;
    }
    dismiss();
  };

  useKeyBindings('slack-connect', [
    {
      match: KeyMatch.Escape,
      label: 'esc',
      action: connected ? 'done' : 'skip',
      handler: () => dismiss(),
    },
  ]);

  if (awaitingLogin) {
    return (
      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        <LoadingBox message="Waiting for authentication..." />
        {store.session.loginUrl && (
          <Box marginTop={1} flexDirection="column">
            <Text>
              <Text dimColor>
                If the browser didn&apos;t open, copy and paste:
              </Text>
              {'\n\n'}
              <Text color="cyan">{store.session.loginUrl}</Text>
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  // Credentials in hand but the first integration check hasn't resolved —
  // hold the nudge so an already-connected user is never asked to connect.
  // Flows that prefetch (mcp tutorial) arrive with the state seeded and
  // never see this.
  if (credentials && connectedState === null) {
    return (
      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        <LoadingBox message="Checking for an existing Slack connection..." />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginTop={1} flexDirection="column">
        {connected ? (
          <Text bold color={Colors.success}>
            {Icons.check} Slack connected
          </Text>
        ) : (
          <Text bold color={Colors.accent}>
            {slack.headline}
          </Text>
        )}

        <Box marginTop={1}>
          <Text>
            {connected
              ? "Slack is connected — here's what you can do:"
              : slack.pitch}
          </Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          {slack.capabilities.map((capability, i) => (
            // Marker + copy in one <Text> so the (long) line wraps as a
            // single flow — separate row-Box siblings drop the marker on
            // wrapped bullets.
            <Box key={i} marginTop={i === 0 ? 0 : 1}>
              <Text>
                <Text color="cyan">{Icons.diamond} </Text>
                {capability}
              </Text>
            </Box>
          ))}
        </Box>

        <Box marginTop={1} flexDirection="column">
          {!connected && (
            <Text dimColor>
              Connect it: <Text color="cyan">{setupUrl}</Text>
            </Text>
          )}
          <Text dimColor>
            Learn more: <Text color="cyan">{learnMoreUrl}</Text>
          </Text>
        </Box>

        <Box marginTop={1}>
          <PickerMenu
            options={
              connected
                ? [{ label: 'Done', value: ChoiceValue.Skip }]
                : [
                    { label: 'Open Slack setup', value: ChoiceValue.Open },
                    { label: 'Skip / Continue', value: ChoiceValue.Skip },
                  ]
            }
            onSelect={handleSelect}
          />
        </Box>
      </Box>
    </Box>
  );
};
