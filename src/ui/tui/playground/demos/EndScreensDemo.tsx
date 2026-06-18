/**
 * EndScreensDemo — Playground demo for the screens shown at the end of
 * a wizard run.
 *
 * Mounts the real SlackConnectScreen and OutroScreen against the shared
 * playground store so every variant can be previewed without a run:
 *
 *   V   switch view          (slack-connect → outro)
 *   K   toggle Slack state   (connected ↔ not connected) — simulates the
 *       poll flipping the screen when the user finishes the browser OAuth
 *   O   cycle outro kind     (success → error → cancel)
 *
 * The playground credentials are re-pointed at a localhost dead-end
 * while this demo is mounted, so SlackConnectScreen's poll fails fast
 * without real network traffic; `K` drives `session.slackConnected`
 * directly, which is the same store key the poll writes.
 *
 * KeepSkillsScreen is intentionally absent — it reads the install dir's
 * .claude/skills/ from disk and calls process.exit() when none are
 * found, which would kill the playground.
 */

import { Box, Text, useInput } from 'ink';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { SlackConnectScreen } from '@ui/tui/screens/SlackConnectScreen';
import { OutroScreen } from '@ui/tui/screens/OutroScreen';
import { Colors } from '@ui/tui/styles';
import { OutroKind, type OutroData } from '@lib/wizard-session';

const VIEWS = ['slack-connect', 'outro'] as const;
type View = (typeof VIEWS)[number];

const OUTRO_KINDS = [OutroKind.Success, OutroKind.Error, OutroKind.Cancel];

const OUTRO_FIXTURES: Record<OutroKind, OutroData> = {
  [OutroKind.Success]: {
    kind: OutroKind.Success,
    message: 'PostHog is set up!',
    changes: [
      'Installed posthog-js and wired the provider',
      'Added pageview + pageleave capture',
      'Instrumented 4 product events',
    ],
    reportFile: 'posthog-setup-report.md',
    dashboardUrl: 'https://us.posthog.com/project/1/dashboard/42',
    notebookUrl: 'https://us.posthog.com/project/1/notebooks/demo',
    docsUrl: 'https://posthog.com/docs/libraries/next-js',
  },
  [OutroKind.Error]: {
    kind: OutroKind.Error,
    message: 'The agent hit an error',
    body: 'The integration step failed before any files were changed.\nRe-run the wizard to try again.',
    docsUrl: 'https://posthog.com/docs/ai-engineering/ai-wizard',
  },
  [OutroKind.Cancel]: {
    kind: OutroKind.Cancel,
    message: 'Cancelled — no changes were made',
  },
};

interface EndScreensDemoProps {
  store: WizardStore;
}

export const EndScreensDemo = ({ store }: EndScreensDemoProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [viewIdx, setViewIdx] = useState(0);
  const [outroKindIdx, setOutroKindIdx] = useState(0);

  const view: View = VIEWS[viewIdx];
  const outroKind = OUTRO_KINDS[outroKindIdx];

  // The playground pre-seeds fake credentials pointed at the real
  // PostHog host, which SlackConnectScreen's poll would hit. Swap the
  // host for a localhost dead-end while this demo is mounted (restore
  // on unmount — tab switches unmount). The credentials must stay
  // non-null: the router derives the active screen from session state,
  // and nulling them drops the playground out of the 'run' screen,
  // unmounting the tab bar and resetting it to the first tab.
  useEffect(() => {
    const previous = store.session.credentials;
    store.setCredentials({
      accessToken: 'playground',
      projectApiKey: 'playground',
      host: 'http://127.0.0.1:9',
      projectId: 0,
    });
    return () => {
      store.setCredentials(previous);
    };
  }, [store]);

  // Seed the outro fixture each screen reads. slackConnected starts
  // null (unknown) so the first paint shows the nudge variant, exactly
  // like a wizard run before the poll's first response.
  useEffect(() => {
    store.setOutroData(OUTRO_FIXTURES[outroKind]);
  }, [store, outroKind]);

  useInput((input) => {
    if (input === 'V' || input === 'v') {
      setViewIdx((i) => (i + 1) % VIEWS.length);
    } else if (input === 'K' || input === 'k') {
      store.setSlackConnected(store.session.slackConnected !== true);
    } else if (input === 'O' || input === 'o') {
      setOutroKindIdx((i) => (i + 1) % OUTRO_KINDS.length);
    }
  });

  const slackState =
    store.session.slackConnected === true ? 'connected' : 'not-connected';

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text dimColor>V view · K slack state · O outro kind</Text>
      <Text dimColor>
        view={view} · slack={slackState} · outro={outroKind}
      </Text>
      <Box marginTop={1} flexDirection="column" flexGrow={1}>
        {view === 'slack-connect' ? (
          <SlackConnectScreen store={store} />
        ) : (
          <OutroScreen store={store} />
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={Colors.muted} dimColor>
          (session-driven previews — the Slack poll points at a localhost
          dead-end; K flips the same store key the poll writes.)
        </Text>
      </Box>
    </Box>
  );
};
