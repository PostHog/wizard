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
 * The mcp and integration flows arrive here already authenticated. The
 * standalone `wizard slack` flow lands without credentials and only
 * triggers OAuth when the user explicitly picks "Open Slack setup" —
 * once authed, the connected-state poll lets the screen flip to the
 * "Slack connected" copy without nagging users who already have it.
 */

import { Box, Text } from 'ink';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { WizardStore } from '@ui/tui/store';
import { Colors, Icons } from '@ui/tui/styles';
import { PickerMenu, LoadingBox } from '@ui/tui/primitives/index';
import { useKeyBindings, KeyMatch } from '@ui/tui/hooks/useKeyBindings';
import { getSlackAppCard } from '@lib/mcp-role-prompts';
import { fetchSlackConnected, ApiError } from '@lib/api';
import { Program } from '@lib/programs/program-registry';
import { getOrAskForProjectData } from '@utils/setup-utils';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import { openTrackedLink, withUtm } from '@utils/links';

interface SlackConnectScreenProps {
  store: WizardStore;
}

enum ChoiceValue {
  Open = 'open',
  Skip = 'skip',
}

enum Phase {
  /** Default — the marketing card with the picker. */
  Nudge = 'nudge',
  /** User picked "Open Slack setup" without credentials; OAuth is in flight. */
  Authenticating = 'authenticating',
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

  // `slackConnected` is three-state: null until something has actually
  // checked (the tutorial's prefetch, or this screen's first poll tick).
  const connectedState = store.session.slackConnected;
  const connected = connectedState === true;

  // Phase.Nudge is the default; Phase.Authenticating fires only when the
  // no-creds user picks "Open Slack setup" — explicit consent for the OAuth
  // dance. Without credentials the connected-state poll can't run, so
  // logging in is what unlocks the screen flipping to "Slack connected" on
  // its own once the browser-side Slack OAuth completes.
  const [phase, setPhase] = useState<Phase>(Phase.Nudge);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Track whether we've already opened the Slack setup link this session.
  // Once we have, the picker drops the "Open Slack setup" CTA (it would
  // just re-fire the same browser action) and swaps in copy telling the
  // user to finish the steps in their browser. The poll will flip the
  // screen to "Slack connected" on its own when it succeeds.
  const [setupOpened, setSetupOpened] = useState(false);
  const openSlackSetup = (): void => {
    openTrackedLink(setupUrl, 'slack-connect-setup');
    setSetupOpened(true);
  };

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
    if (credentials || nudgeImpressionFired.current) return;
    nudgeImpressionFired.current = true;
    analytics.wizardCapture('slack connect nudge shown', { role });
  }, [credentials, role]);

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
        credentials.host.apiHost,
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
          // Stop polling — repeating a failing call every tick would spam
          // error tracking. The nudge copy is the fallback either way; a
          // failed check counts as not connected so the screen doesn't sit
          // on the loading state.
          if (store.session.slackConnected === null) {
            store.setSlackConnected(false);
          }
          // Skip capturing transient connectivity blips (connect timeout,
          // refused, DNS hiccup): this path already degrades gracefully, so
          // a messageless network error is unactionable noise. Genuine
          // auth/permission failures still carry a real message and are
          // captured once.
          if (err instanceof ApiError && err.isTransient) return;
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
      setLoginError(null);
      // With credentials, the screen stays up and the existing poll flips
      // it to connected once the user finishes the browser Slack OAuth.
      // Without credentials, we kick off the wizard OAuth first so the
      // poll can run after the user returns — opening Slack setup before
      // login would mean we never get to confirm the connection.
      if (credentials) {
        openSlackSetup();
        return;
      }
      setPhase(Phase.Authenticating);
      return;
    }
    dismiss();
  };

  // OAuth runs when entering Authenticating. On success we land creds in
  // the store, open the Slack setup link, and return to Nudge — the
  // connected-state poll (keyed on credentials) then kicks in
  // automatically. On failure we surface the error inline and stay put.
  useEffect(() => {
    if (phase !== Phase.Authenticating) return;
    let cancelled = false;

    void (async () => {
      try {
        const data = await getOrAskForProjectData({
          signup: false,
          ci: false,
          apiKey: undefined,
          projectId: undefined,
          programId: Program.SlackConnect,
        });
        if (cancelled) return;
        store.setCredentials({
          accessToken: data.accessToken,
          projectApiKey: data.projectApiKey,
          host: data.host,
          projectId: data.projectId,
        });
        store.setRoleAtOrganization(data.roleAtOrganization);
        store.setApiUser(data.user);
        store.setLoginUrl(null);
        openSlackSetup();
        setPhase(Phase.Nudge);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        logToFile(`[SlackConnectScreen] login failed: ${message}`);
        analytics.captureException(
          err instanceof Error ? err : new Error(String(err)),
          { step: 'slack_connect_login' },
        );
        store.setLoginUrl(null);
        setLoginError(message);
        setPhase(Phase.Nudge);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [phase, role, setupUrl, store]);

  useKeyBindings('slack-connect', [
    {
      match: KeyMatch.Escape,
      label: 'esc',
      action:
        phase === Phase.Authenticating ? 'cancel' : connected ? 'done' : 'skip',
      handler: () => {
        // Cancelling OAuth from the Authenticating phase returns to the
        // nudge without dismissing — the user can retry, skip, or pick
        // another action. The effect's cleanup discards the in-flight
        // login result via the cancelled flag.
        if (phase === Phase.Authenticating) {
          store.setLoginUrl(null);
          setPhase(Phase.Nudge);
          return;
        }
        dismiss();
      },
    },
  ]);

  if (phase === Phase.Authenticating) {
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

  // Waiting-for-browser state: after the user has picked "Open Slack
  // setup" we've already triggered the browser action. Re-offering it as
  // the headline CTA is confusing; surface "go finish it in your browser"
  // copy and demote re-open to a recovery action.
  const awaitingBrowser = setupOpened && !connected;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginTop={1} flexDirection="column">
        {connected ? (
          <Text bold color={Colors.success}>
            {Icons.check} Slack connected
          </Text>
        ) : awaitingBrowser ? (
          <Text bold color={Colors.accent}>
            Finish connecting Slack
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
              : awaitingBrowser
              ? "We've opened PostHog's Slack setup page in your browser. Authorize the Slack app there — we'll detect the connection automatically and continue."
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
              {awaitingBrowser ? 'Setup page: ' : 'Connect it: '}
              <Text color="cyan">{setupUrl}</Text>
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
                : awaitingBrowser
                ? [
                    {
                      label: 'Re-open Slack setup',
                      value: ChoiceValue.Open,
                    },
                    { label: 'Skip / Continue', value: ChoiceValue.Skip },
                  ]
                : [
                    { label: 'Open Slack setup', value: ChoiceValue.Open },
                    { label: 'Skip / Continue', value: ChoiceValue.Skip },
                  ]
            }
            onSelect={handleSelect}
          />
        </Box>

        {loginError && (
          <Box marginTop={1}>
            <Text color="red">
              Login failed: {loginError}. Try again or skip.
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
