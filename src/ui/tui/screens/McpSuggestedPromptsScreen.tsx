/**
 * McpSuggestedPromptsScreen — shown after MCP install succeeds in the
 * standalone `wizard mcp add` program.
 *
 * Phases:
 *   1. Choose         — opens with a Log in / Exit picker, framed by a
 *                       hardcoded teaser of three example prompts.
 *   2. Authenticating — runs `services.performLogin()` (OAuth in
 *                       production, canned values in the playground).
 *                       Renders a spinner + login URL inline while the
 *                       promise is pending. Errors return to Choose
 *                       with an inline error line.
 *   3. PromptPicker   — lists the role-tailored kit; user picks one to
 *                       run. The picker has its own "Exit" entry so
 *                       dismissal is discoverable without a hidden
 *                       hotkey.
 *   4. Running        — streams the agent's response inline via
 *                       `services.runPromptStreaming`. `[esc]` aborts
 *                       and returns to the picker; `[enter]` after
 *                       completion goes back to the picker so the user
 *                       can run another or exit.
 *
 * Credentials are guaranteed non-null once PromptPicker / Running are
 * reached (the Choose → Authenticating gate forces a successful login
 * before getting there). A defensive throw protects the Running
 * useEffect against a state-machine bug.
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
  type SuggestedPrompt,
} from '@lib/mcp-role-prompts';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import type {
  AgentChunk,
  McpSuggestedPromptsServices,
} from '@ui/tui/services/mcp-suggested-prompts-services';

interface McpSuggestedPromptsScreenProps {
  store: WizardStore;
  services: McpSuggestedPromptsServices;
}

enum Phase {
  Choose = 'choose',
  Authenticating = 'authenticating',
  PromptPicker = 'prompt-picker',
  Running = 'running',
  Done = 'done',
}

enum ChoiceValue {
  Login = 'login',
  Exit = 'exit',
}

// Sentinel value used by the PromptPicker so "Exit" sits as a regular
// option alongside the role-tailored prompts.
const PICKER_EXIT_VALUE = '__exit__';

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
  const [loginError, setLoginError] = useState<string | null>(null);
  const [runningPrompt, setRunningPrompt] = useState<string | null>(null);
  const [runChunks, setRunChunks] = useState<AgentChunk[]>([]);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);

  // AbortController for the in-flight runPromptStreaming call. Lifted
  // to a ref so [esc] / unmount can call abort() without the closure
  // needing to re-bind on every state change.
  const runAbortRef = useRef<AbortController | null>(null);

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
        setPhase(Phase.PromptPicker);
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

  // Stream the chosen prompt against the agent.
  useEffect(() => {
    if (phase !== Phase.Running) return;
    if (!runningPrompt) return;
    if (!session.credentials) {
      throw new Error(
        '[McpSuggestedPromptsScreen] Running phase reached without credentials. The Choose gate should have prevented this.',
      );
    }

    const controller = new AbortController();
    runAbortRef.current = controller;
    const startedAt = Date.now();
    setRunStartedAt(startedAt);
    setRunChunks([]);

    void (async () => {
      const credentials = session.credentials;
      if (!credentials) return;
      try {
        for await (const chunk of services.runPromptStreaming({
          prompt: runningPrompt,
          credentials,
          signal: controller.signal,
        })) {
          if (controller.signal.aborted) return;
          setRunChunks((prev) => [...prev, chunk]);
          if (chunk.kind === 'done') {
            analytics.wizardCapture('mcp suggested prompts run', {
              prompt: runningPrompt,
              durationMs: Date.now() - startedAt,
            });
            return;
          }
          if (chunk.kind === 'error') {
            analytics.wizardCapture('mcp suggested prompts run failed', {
              prompt: runningPrompt,
              error: chunk.text,
            });
            return;
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        const text = err instanceof Error ? err.message : String(err);
        setRunChunks((prev) => [...prev, { kind: 'error', text }]);
        analytics.wizardCapture('mcp suggested prompts run failed', {
          prompt: runningPrompt,
          error: text,
        });
      }
    })();

    return () => {
      controller.abort();
      if (runAbortRef.current === controller) runAbortRef.current = null;
    };
  }, [phase, runningPrompt, services, session.credentials]);

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

  const handlePromptPick = (value: string | string[]): void => {
    const picked = Array.isArray(value) ? value[0] : value;
    if (picked === PICKER_EXIT_VALUE) {
      dismiss();
      return;
    }
    setRunningPrompt(picked);
    setPhase(Phase.Running);
  };

  useKeyBindings('mcp-suggested-prompts', [
    {
      match: KeyMatch.Escape,
      label: 'esc',
      action: phase === Phase.Running ? 'cancel run' : 'back',
      handler: () => {
        if (phase === Phase.Running) {
          runAbortRef.current?.abort();
          setPhase(Phase.PromptPicker);
        }
      },
    },
    {
      match: KeyMatch.Return,
      label: 'enter',
      action: phase === Phase.Running ? 'back to prompts' : 'continue',
      handler: () => {
        if (phase === Phase.Running) {
          const finished = runChunks.some(
            (c) => c.kind === 'done' || c.kind === 'error',
          );
          if (finished) setPhase(Phase.PromptPicker);
        }
      },
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

        {phase === Phase.PromptPicker && (
          <PromptPickerPhase
            promptKit={kit}
            roleLabel={roleLabel}
            onSelect={handlePromptPick}
          />
        )}

        {phase === Phase.Running && runningPrompt && (
          <RunningPhase
            prompt={runningPrompt}
            chunks={runChunks}
            startedAt={runStartedAt}
          />
        )}
      </Box>
    </Box>
  );
};

// ── Choose phase ───────────────────────────────────────────────────────

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
    category: 'Error tracking',
    prompt:
      'Show me the full stack trace for the most recent crash, then propose a fix.',
    description:
      'Pulls the stack trace, error message, and metadata so the agent can suggest code changes.',
  },
  {
    category: 'Product analytics',
    prompt:
      'Build a weekly signups insight broken down by acquisition channel and save it for the team.',
    description:
      'Picks the right query type, configures the breakdown, and saves the insight back to your project.',
  },
  {
    category: 'Feature flags & experiments',
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
        The whole PostHog platform is now in your editor — product analytics,
        error tracking, feature flags, SQL, and more. Read it, write it, build
        new things on top. A taste:
      </Text>
    </Box>

    <Box marginTop={1} flexDirection="column">
      {CHOOSE_EXAMPLES.map((ex) => (
        <Box key={ex.prompt} flexDirection="column" marginBottom={1}>
          <Text color={Colors.accent}>
            {Icons.diamond} &quot;{ex.prompt}&quot;
          </Text>
          <Text dimColor>
            {' '}
            {ex.category}: {ex.description}
          </Text>
        </Box>
      ))}
    </Box>

    <Box marginBottom={1}>
      <Text dimColor>
        There&apos;s a lot more — dashboards and insights you can build from
        scratch, raw HogQL queries, CDP destinations, cohort management, support
        ticket triage, and multi-step recipes that chain it all together.
      </Text>
    </Box>

    <Text>
      We can show you right now. Want to see the MCP query your data in real
      time?
    </Text>

    <Box marginTop={1}>
      <PickerMenu
        options={[
          { label: 'Log in', value: ChoiceValue.Login },
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

// ── Authenticating phase ───────────────────────────────────────────────

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

// ── Prompt picker phase ────────────────────────────────────────────────

interface PromptPickerPhaseProps {
  promptKit: SuggestedPrompt[];
  roleLabel: string | null;
  onSelect: (value: string | string[]) => void;
}

const PromptPickerPhase = ({
  promptKit,
  roleLabel,
  onSelect,
}: PromptPickerPhaseProps) => {
  const options = [
    ...promptKit.map((p) => ({
      label: p.prompt,
      value: p.prompt,
      hint: p.description,
    })),
    { label: 'Exit', value: PICKER_EXIT_VALUE },
  ];

  return (
    <Box flexDirection="column">
      <Text>
        {roleLabel
          ? `Picked for ${roleLabel} — pick one to try with your project's data:`
          : 'Pick one to try with your project’s data:'}
      </Text>
      <Box marginTop={1}>
        <PickerMenu options={options} onSelect={onSelect} />
      </Box>
    </Box>
  );
};

// ── Running phase ──────────────────────────────────────────────────────

interface RunningPhaseProps {
  prompt: string;
  chunks: AgentChunk[];
  startedAt: number | null;
}

const RunningPhase = ({ prompt, chunks, startedAt }: RunningPhaseProps) => {
  const isDone = chunks.some((c) => c.kind === 'done');
  const errorChunk = chunks.find((c) => c.kind === 'error');
  const finished = isDone || !!errorChunk;
  const elapsed = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>Running:</Text> <Text color={Colors.accent}>{prompt}</Text>
      </Text>
      <Box marginTop={1}>
        <Text dimColor>
          {finished
            ? errorChunk
              ? `Failed after ${elapsed}s — press [enter] to pick another, or [esc] to exit.`
              : `Done in ${elapsed}s — press [enter] for another, or [esc] to exit.`
            : 'Streaming from PostHog · [esc] to cancel'}
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {chunks.map((chunk, idx) => (
          <ChunkLine key={idx} chunk={chunk} />
        ))}
      </Box>
    </Box>
  );
};

interface ChunkLineProps {
  chunk: AgentChunk;
}

const ChunkLine = ({ chunk }: ChunkLineProps) => {
  if (chunk.kind === 'text') {
    return <Text>{chunk.text}</Text>;
  }
  if (chunk.kind === 'tool-call') {
    return (
      <Text dimColor>
        {'  '}
        <Text color="cyan">↳ {chunk.toolName}</Text>
        {chunk.detail ? ` ${chunk.detail}` : ''}
      </Text>
    );
  }
  if (chunk.kind === 'tool-result') {
    return (
      <Text dimColor>
        {'    '}
        <Text color="green">✓</Text> {chunk.detail}
      </Text>
    );
  }
  if (chunk.kind === 'error') {
    return <Text color="red">Error: {chunk.text}</Text>;
  }
  // 'done' — no visual chunk; the dim status line above handles it.
  return null;
};
