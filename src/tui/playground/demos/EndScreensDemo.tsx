/**
 * EndScreensDemo — Playground demo for the screens shown at the end of
 * a wizard run.
 *
 * Mounts the real OutroScreen against the shared playground store so
 * every variant can be previewed without a run:
 *
 *   O   cycle outro kind     (success → error → cancel)
 *
 * KeepSkillsScreen is intentionally absent — it reads the install dir's
 * .claude/skills/ from disk and calls process.exit() when none are
 * found, which would kill the playground.
 */

import { Box, Text, useInput } from 'ink';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@tui/store';
import { OutroScreen } from '@tui/screens/OutroScreen';
import { Colors } from '@tui/styles';
import { OutroKind, type OutroData } from '@programs/session/wizard-session';

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

  const [outroKindIdx, setOutroKindIdx] = useState(0);

  const outroKind = OUTRO_KINDS[outroKindIdx];

  // Seed the outro fixture the screen reads.
  useEffect(() => {
    store.setOutroData(OUTRO_FIXTURES[outroKind]);
  }, [store, outroKind]);

  useInput((input) => {
    if (input === 'O' || input === 'o') {
      setOutroKindIdx((i) => (i + 1) % OUTRO_KINDS.length);
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text dimColor>O outro kind</Text>
      <Text dimColor>outro={outroKind}</Text>
      <Box marginTop={1} flexDirection="column" flexGrow={1}>
        <OutroScreen store={store} />
      </Box>
      <Box marginTop={1}>
        <Text color={Colors.muted} dimColor>
          (session-driven preview of the outro screen.)
        </Text>
      </Box>
    </Box>
  );
};
