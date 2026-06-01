/**
 * SuggestedPromptsScreen — shown after MCP install succeeds.
 *
 * Two phases:
 *   1. Verify — show one safe test prompt and poll the activity_log endpoint
 *      for ~30 seconds. Celebrates when activity is detected, or when the
 *      user marks the prompt verified manually. Times out gracefully.
 *   2. Prompts — render a role + framework-tailored list of 5 prompts the
 *      user can copy and run with their agent. Press Enter to continue.
 *
 * The screen only renders when `mcpOutcome === Installed` — skipped /
 * failed paths bypass this and go straight to the outro. See the program
 * step's `show` predicate in posthog-integration/steps.ts.
 */

import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import { useSyncExternalStore } from 'react';

import type { WizardStore } from '@ui/tui/store';
import { Colors } from '@ui/tui/styles';
import { useKeyBindings, KeyMatch } from '@ui/tui/hooks/useKeyBindings';
import { fetchRecentActivity } from '@lib/api';
import {
  getRolePrompts,
  getRoleLabel,
  VERIFY_PROMPT,
  type SuggestedPrompt,
} from '@lib/role-prompts';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';

interface SuggestedPromptsScreenProps {
  store: WizardStore;
}

enum Phase {
  Verifying = 'verifying',
  Celebrated = 'celebrated',
  TimedOut = 'timed-out',
  Done = 'done',
}

const VERIFY_TIMEOUT_MS = 30_000;
const VERIFY_POLL_MS = 3_000;

export const SuggestedPromptsScreen = ({
  store,
}: SuggestedPromptsScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const session = store.session;
  const role = session.roleAtOrganization;
  const roleLabel = getRoleLabel(role);
  const kit = getRolePrompts(role, session.integration);
  const installedClient = session.mcpInstalledClients[0] ?? 'your agent';

  const [phase, setPhase] = useState<Phase>(Phase.Verifying);
  const [detectedActivity, setDetectedActivity] = useState<string | null>(null);

  // Poll the activity_log endpoint after install. Best-effort — auth errors,
  // missing scopes, and network blips all silently degrade to "timed out",
  // which falls through to the prompt list anyway.
  useEffect(() => {
    if (phase !== Phase.Verifying) return;
    if (!session.credentials) {
      setPhase(Phase.TimedOut);
      return;
    }

    const startedAt = new Date();
    const { accessToken, host, projectId } = session.credentials;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      const recent = await fetchRecentActivity(
        accessToken,
        projectId,
        host,
        startedAt,
      );
      if (cancelled) return;
      if (recent.length > 0) {
        const top = recent[0];
        // Build a friendly action label from scope/activity, e.g. "FeatureFlag · updated".
        const scope = top.scope ?? 'PostHog';
        const activity = top.activity ?? 'change';
        setDetectedActivity(`${scope} · ${activity}`);
        setPhase(Phase.Celebrated);
        analytics.wizardCapture('mcp verify success', {
          scope,
          activity,
          via: 'activity_log_poll',
        });
        return;
      }
    };

    const interval = setInterval(() => void tick(), VERIFY_POLL_MS);
    const timeout = setTimeout(() => {
      if (cancelled) return;
      setPhase(Phase.TimedOut);
      logToFile('[SuggestedPromptsScreen] verify timed out');
      analytics.wizardCapture('mcp verify timeout', {});
    }, VERIFY_TIMEOUT_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []); // eslint-disable-line

  const advance = (): void => {
    setPhase(Phase.Done);
    // Defer one tick so any concurrent setState has flushed before the router
    // re-resolves on the new screen completion predicate.
    setTimeout(() => {
      store.setSuggestedPromptsDismissed();
    }, 0);
  };

  const markVerifiedManually = (): void => {
    if (phase === Phase.Verifying) {
      analytics.wizardCapture('mcp verify success', { via: 'manual' });
      setPhase(Phase.Celebrated);
    }
  };

  useKeyBindings('suggested-prompts', [
    {
      match: KeyMatch.Return,
      label: 'enter',
      action: phase === Phase.Verifying ? 'skip verify' : 'continue',
      handler: () => {
        if (phase === Phase.Verifying) {
          setPhase(Phase.TimedOut);
        } else {
          advance();
        }
      },
    },
    {
      match: 'v',
      label: 'v',
      action: 'verified',
      handler: markVerifiedManually,
    },
  ]);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        Try it out
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Verify
          phase={phase}
          prompt={VERIFY_PROMPT}
          client={installedClient}
          detectedActivity={detectedActivity}
        />

        {(phase === Phase.Celebrated || phase === Phase.TimedOut) && (
          <PromptList
            promptKit={kit.filter((p) => p.prompt !== VERIFY_PROMPT.prompt)}
            roleLabel={roleLabel}
          />
        )}
      </Box>
    </Box>
  );
};

interface VerifyProps {
  phase: Phase;
  prompt: SuggestedPrompt;
  client: string;
  detectedActivity: string | null;
}

const Verify = ({ phase, prompt, client, detectedActivity }: VerifyProps) => {
  if (phase === Phase.Verifying) {
    return (
      <Box flexDirection="column">
        <Text>
          Paste this into <Text bold>{client}</Text> to confirm it works:
        </Text>
        <Box
          marginTop={1}
          paddingX={2}
          paddingY={1}
          borderStyle="round"
          borderColor={Colors.muted}
          flexDirection="column"
        >
          <Text color={Colors.accent}>{prompt.prompt}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            Watching for activity (auto-detect, ~30s). Press{' '}
            <Text bold>[v]</Text> to mark verified, or <Text bold>[enter]</Text>{' '}
            to skip.
          </Text>
        </Box>
      </Box>
    );
  }

  if (phase === Phase.Celebrated) {
    return (
      <Box flexDirection="column">
        <Text color="green" bold>
          {'✔'} Your agent just talked to PostHog. You're set.
        </Text>
        {detectedActivity && <Text dimColor>Detected: {detectedActivity}</Text>}
      </Box>
    );
  }

  // TimedOut and Done both reach here. We render the timed-out copy because
  // Done is a one-frame state before the router advances.
  return (
    <Box flexDirection="column">
      <Text dimColor>
        Didn't catch anything in 30s — that's normal. Try one of these prompts
        whenever you're ready:
      </Text>
    </Box>
  );
};

interface PromptListProps {
  promptKit: SuggestedPrompt[];
  roleLabel: string | null;
}

const PromptList = ({ promptKit, roleLabel }: PromptListProps) => (
  <Box flexDirection="column" marginTop={2}>
    <Text bold>
      {roleLabel ? `Picked for ${roleLabel}:` : 'A few to get you started:'}
    </Text>
    <Box flexDirection="column" marginTop={1}>
      {promptKit.map((p, idx) => (
        <Box key={p.prompt} flexDirection="column" marginBottom={1}>
          <Text>
            <Text color={Colors.accent}>{idx + 1}.</Text>{' '}
            <Text bold>{p.prompt}</Text>
          </Text>
          <Text dimColor> {p.description}</Text>
        </Box>
      ))}
    </Box>
    <Box marginTop={1}>
      <Text dimColor>Press [enter] to continue.</Text>
    </Box>
  </Box>
);
