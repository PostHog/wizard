/**
 * McpSuggestedPromptsScreen — shown after MCP install succeeds in the
 * standalone `wizard mcp add` program.
 *
 * Phases:
 *   1. Choose         — opens with a [Log in] / [Exit] picker. Exit ends
 *                       the program. Log in transitions to Authenticating.
 *   2. Authenticating — runs `services.performLogin()` (OAuth in
 *                       production, canned values in the playground).
 *                       Renders a spinner + login URL inline while the
 *                       promise is pending. Errors return to Choose with
 *                       an inline error line.
 *   3. Verifying      — polls the activity log via
 *                       `services.fetchActivitySince` until either a hit
 *                       arrives, the 30s timeout fires, or the user
 *                       presses [v] / [enter] to short-circuit.
 *   4. Celebrated / TimedOut — terminal verify states; render the
 *                       role-tailored prompt list. [enter] dismisses.
 *
 * Credentials are guaranteed non-null once Verifying is reached (the
 * Choose gate forces a successful login before getting there). The
 * screen does not contain a defensive null-credentials branch — that
 * would only fire on a state bug, not on a normal user path.
 */

import { Box, Text } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { useSyncExternalStore } from 'react';

import type { WizardStore } from '@ui/tui/store';
import { Colors, Icons } from '@ui/tui/styles';
import { useKeyBindings, KeyMatch } from '@ui/tui/hooks/useKeyBindings';
import { LoadingBox, PickerMenu } from '@ui/tui/primitives/index';
import {
  getRolePrompts,
  getRoleLabel,
  VERIFY_PROMPT,
  type SuggestedPrompt,
} from '@lib/mcp-role-prompts';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import type { McpSuggestedPromptsServices } from '@ui/tui/services/mcp-suggested-prompts-services';

interface McpSuggestedPromptsScreenProps {
  store: WizardStore;
  services: McpSuggestedPromptsServices;
}

enum Phase {
  Choose = 'choose',
  Authenticating = 'authenticating',
  Verifying = 'verifying',
  Celebrated = 'celebrated',
  TimedOut = 'timed-out',
  Done = 'done',
}

enum ChoiceValue {
  Login = 'login',
  Exit = 'exit',
}

const VERIFY_TIMEOUT_MS = 30_000;
const VERIFY_POLL_MS = 3_000;

export const McpSuggestedPromptsScreen = ({
  store,
  services,
}: McpSuggestedPromptsScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const session = store.session;
  const role = session.roleAtOrganization;
  const roleLabel = getRoleLabel(role);
  const kit = getRolePrompts(role, session.integration);
  const installedClient = session.mcpInstalledClients[0] ?? 'your agent';

  const [phase, setPhase] = useState<Phase>(Phase.Choose);
  const [detectedActivity, setDetectedActivity] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Run OAuth when entering Authenticating phase.
  useEffect(() => {
    if (phase !== Phase.Authenticating) return;
    let cancelled = false;

    void (async () => {
      try {
        const { credentials, roleAtOrganization } =
          await services.performLogin();
        if (cancelled) return;
        store.setCredentials(credentials);
        store.setRoleAtOrganization(roleAtOrganization);
        store.setLoginUrl(null);
        setPhase(Phase.Verifying);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        logToFile(`[McpSuggestedPromptsScreen] login failed: ${message}`);
        store.setLoginUrl(null);
        setLoginError(message);
        setPhase(Phase.Choose);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [phase, services, store]);

  // Poll the activity_log endpoint during Verifying. The closure-owned
  // `stopped` flag + `stopRef` lets every exit (timeout, [v], hit) cancel
  // the others — fixes the race where a late tick could flip TimedOut
  // back to Celebrated.
  const stopVerifyRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (phase !== Phase.Verifying) return;
    // The Choose → Authenticating → Verifying chain only transitions
    // here after performLogin() sets credentials. If we still see null,
    // a state bug snuck in — surface it loudly rather than silently
    // swallowing into TimedOut.
    if (!session.credentials) {
      throw new Error(
        '[McpSuggestedPromptsScreen] Verifying phase reached without credentials. The Choose gate should have prevented this.',
      );
    }

    const startedAt = new Date();
    const { accessToken, host, projectId } = session.credentials;
    let stopped = false;

    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
      clearTimeout(timeout);
    };

    const tick = async (): Promise<void> => {
      if (stopped) return;
      const recent = await services.fetchActivitySince({
        accessToken,
        projectId,
        host,
        since: startedAt,
      });
      if (stopped) return;
      if (recent.length > 0) {
        const top = recent[0];
        const scope = top.scope ?? 'PostHog';
        const activity = top.activity ?? 'change';
        stop();
        setDetectedActivity(`${scope} · ${activity}`);
        setPhase(Phase.Celebrated);
        analytics.wizardCapture('mcp suggested prompts verified', {
          scope,
          activity,
          via: 'activity_log_poll',
        });
      }
    };

    const interval = setInterval(() => void tick(), VERIFY_POLL_MS);
    const timeout = setTimeout(() => {
      if (stopped) return;
      stop();
      setPhase(Phase.TimedOut);
      logToFile('[McpSuggestedPromptsScreen] verify timed out');
      analytics.wizardCapture('mcp suggested prompts timed out', {});
    }, VERIFY_TIMEOUT_MS);

    stopVerifyRef.current = stop;

    return () => {
      stop();
      stopVerifyRef.current = null;
    };
  }, [phase, services, session.credentials]);

  const dismiss = (): void => {
    setPhase(Phase.Done);
    setTimeout(() => {
      store.setMcpSuggestedPromptsDismissed();
    }, 0);
  };

  const handleChoice = (value: ChoiceValue | ChoiceValue[]): void => {
    const choice = Array.isArray(value) ? value[0] : value;
    setLoginError(null);
    if (choice === ChoiceValue.Login) {
      analytics.wizardCapture('mcp suggested prompts choose', {
        choice: 'login',
      });
      setPhase(Phase.Authenticating);
    } else {
      analytics.wizardCapture('mcp suggested prompts choose', {
        choice: 'exit',
      });
      dismiss();
    }
  };

  const markVerifiedManually = (): void => {
    if (phase !== Phase.Verifying) return;
    stopVerifyRef.current?.();
    analytics.wizardCapture('mcp suggested prompts verified', {
      via: 'manual',
    });
    setPhase(Phase.Celebrated);
  };

  useKeyBindings('mcp-suggested-prompts', [
    {
      match: KeyMatch.Return,
      label: 'enter',
      action: phase === Phase.Verifying ? 'skip verify' : 'continue',
      handler: () => {
        if (phase === Phase.Choose || phase === Phase.Authenticating) return;
        if (phase === Phase.Verifying) {
          stopVerifyRef.current?.();
          setPhase(Phase.TimedOut);
        } else {
          dismiss();
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
        Suggested prompts
      </Text>

      <Box marginTop={1} flexDirection="column">
        {phase === Phase.Choose && (
          <ChoosePhase
            client={installedClient}
            error={loginError}
            onSelect={handleChoice}
          />
        )}

        {phase === Phase.Authenticating && (
          <AuthenticatingPhase loginUrl={session.loginUrl} />
        )}

        {(phase === Phase.Verifying ||
          phase === Phase.Celebrated ||
          phase === Phase.TimedOut ||
          phase === Phase.Done) && (
          <Verify
            phase={phase}
            prompt={VERIFY_PROMPT}
            client={installedClient}
            detectedActivity={detectedActivity}
          />
        )}

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

interface ChoosePhaseProps {
  client: string;
  error: string | null;
  onSelect: (value: ChoiceValue | ChoiceValue[]) => void;
}

const CHOOSE_EXAMPLES: ReadonlyArray<{
  category: string;
  prompt: string;
  description: string;
}> = [
  {
    category: 'Error Tracking',
    prompt:
      'Show me the stack trace for the most recent crash, then propose a fix.',
    description:
      'Pulls the stack trace and error message so the agent can suggest code changes.',
  },
  {
    category: 'Product Analytics',
    prompt:
      'Build a weekly signups insight broken down by channel and save it for the team.',
    description:
      'Picks the right query type, configures the breakdown, and saves the insight back to your project.',
  },
  {
    category: 'Feature Flags & Experiments',
    prompt:
      'Create an A/B test for our pricing page that measures conversion to checkout.',
    description: 'Configures control and test variants with a funnel metric.',
  },
];

const ChoosePhase = ({ client, error, onSelect }: ChoosePhaseProps) => (
  <Box flexDirection="column">
    <Text>
      MCP is installed for <Text bold>{client}</Text>.
    </Text>

    <Box marginTop={1}>
      <Text>
        Your agent can now access the PostHog platform when you prompt it to.
        Build dashboards, run SQL queries, deploy feature flags, and more.
      </Text>
    </Box>

    <Box marginTop={1} flexDirection="column">
      {CHOOSE_EXAMPLES.map((ex) => (
        <Box key={ex.prompt} flexDirection="column" marginBottom={1}>
          <Text>
            <Text color="cyan">{Icons.diamond}</Text> &quot;
            <Text color="cyan">{ex.prompt}</Text>&quot;{' '}
            <Text dimColor>({ex.category})</Text>
          </Text>
        </Box>
      ))}
    </Box>

    <Box marginTop={1}>
      <Text>Want a live demo with real data from your project?</Text>
    </Box>

    <Box marginTop={1}>
      <Text>Log in to start a personalized tutorial with MCP.</Text>
    </Box>

    <Box marginTop={1}>
      <PickerMenu
        options={[
          { label: 'Start MCP tutorial', value: ChoiceValue.Login },
          { label: 'Exit', value: ChoiceValue.Exit },
        ]}
        onSelect={onSelect}
      />
    </Box>
    {error && (
      <Box marginTop={1}>
        <Text color="red">Login failed: {error}. Try again or exit.</Text>
      </Box>
    )}
  </Box>
);

interface AuthenticatingPhaseProps {
  loginUrl: string | null;
}

const AuthenticatingPhase = ({ loginUrl }: AuthenticatingPhaseProps) => (
  <Box flexDirection="column">
    <LoadingBox message="Waiting for authentication..." />
    {loginUrl && (
      <Box marginTop={1} marginBottom={1} flexDirection="column">
        <Text>
          <Text dimColor>If the browser didn&apos;t open, copy and paste:</Text>
          {'\n\n'}
          <Text color="cyan">{loginUrl}</Text>
        </Text>
      </Box>
    )}
  </Box>
);

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
          <Text dimColor>{prompt.description}</Text>
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
          {'✔'} Your agent just talked to PostHog. You&apos;re set.
        </Text>
        {detectedActivity && <Text dimColor>Detected: {detectedActivity}</Text>}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text dimColor>
        Didn&apos;t catch anything in 30s — that&apos;s normal. Try one of these
        prompts whenever you&apos;re ready:
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
