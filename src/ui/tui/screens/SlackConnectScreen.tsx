/**
 * SlackConnectScreen — the dedicated "Connect Slack" step shown after the
 * MCP tutorial (`wizard mcp tutorial`) and after a successful install
 * (`wizard mcp add`).
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
 */

import { Box, Text } from 'ink';
import { useEffect, useSyncExternalStore } from 'react';
import opn from 'opn';

import type { WizardStore } from '@ui/tui/store';
import { Colors, Icons } from '@ui/tui/styles';
import { PickerMenu } from '@ui/tui/primitives/index';
import { useKeyBindings, KeyMatch } from '@ui/tui/hooks/useKeyBindings';
import { getSlackAppCard } from '@lib/mcp-role-prompts';
import { fetchSlackConnected } from '@lib/api';
import { analytics } from '@utils/analytics';

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

  // Impression — once per mount, not per render.
  useEffect(() => {
    analytics.wizardCapture('slack connect shown', { role });
  }, []);

  // Seeded by the tutorial screen's prefetch (session.slackConnected),
  // so the first render already shows the right variant. While not
  // connected, poll: connecting Slack is a manual OAuth step in the
  // browser, so the poll is what flips the screen to the connected
  // state when the user comes back. Without credentials (user skipped
  // login) it renders the connect nudge.
  const connected = store.session.slackConnected === true;
  const credentials = store.session.credentials;
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
            store.setSlackConnected(true);
          } else {
            timer = setTimeout(check, POLL_INTERVAL_MS);
          }
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          // Capture once and stop polling — repeating a failing call
          // every tick would spam error tracking. The nudge copy is
          // the fallback either way.
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

  const dismiss = (): void => {
    analytics.wizardCapture('slack connect skipped', { role, connected });
    store.setSlackStepDismissed();
  };

  const handleSelect = (value: ChoiceValue | ChoiceValue[]): void => {
    const choice = Array.isArray(value) ? value[0] : value;
    if (choice === ChoiceValue.Open) {
      analytics.wizardCapture('slack connect opened', { role });
      // Fire-and-forget. opn throws in environments without a browser
      // (headless/remote) — the setup URL is printed on screen as a
      // fallback, so swallow the error. The screen stays up; the poll
      // flips it to connected once the OAuth step completes.
      if (process.env.NODE_ENV !== 'test') {
        opn(slack.setupUrl, { wait: false }).catch(() => {
          // No browser available — the printed URL is the fallback.
        });
      }
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
              Connect it: <Text color="cyan">{slack.setupUrl}</Text>
            </Text>
          )}
          <Text dimColor>
            Learn more: <Text color="cyan">{slack.learnMoreUrl}</Text>
          </Text>
        </Box>

        <Box marginTop={1}>
          <PickerMenu
            options={
              connected
                ? [{ label: 'Done', value: ChoiceValue.Skip }]
                : [
                    { label: 'Open Slack setup', value: ChoiceValue.Open },
                    { label: 'Skip', value: ChoiceValue.Skip },
                  ]
            }
            onSelect={handleSelect}
          />
        </Box>
      </Box>
    </Box>
  );
};
