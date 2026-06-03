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
import { Spinner } from '@inkjs/ui';
import { useEffect, useRef, useState } from 'react';
import { useSyncExternalStore } from 'react';

import type { WizardStore } from '@ui/tui/store';
import { Colors, Icons } from '@ui/tui/styles';
import { useKeyBindings, KeyMatch } from '@ui/tui/hooks/useKeyBindings';
import {
  ContentSequencer,
  LoadingBox,
  PickerMenu,
  TextRevealMode,
  type ContentBlock,
} from '@ui/tui/primitives/index';
import {
  STOCK_MCP_SUGGESTED_PROMPTS,
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

export const McpSuggestedPromptsScreen = ({
  store,
  services,
}: McpSuggestedPromptsScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const session = store.session;
  // The role + framework matrix in mcp-role-prompts.ts is intentionally
  // kept for future use (and the OAuth plumbing still populates
  // session.roleAtOrganization). For now the picker shows the same
  // generic kit to every user.
  const kit = STOCK_MCP_SUGGESTED_PROMPTS;

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
        const { credentials, roleAtOrganization, user } =
          await services.performLogin();
        if (cancelled) return;
        store.setCredentials(credentials);
        store.setRoleAtOrganization(roleAtOrganization);
        store.setApiUser(user);
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
    setRunningPrompt(picked);
    setPhase(Phase.Running);
  };

  useKeyBindings('mcp-suggested-prompts', [
    {
      match: KeyMatch.Escape,
      label: 'esc',
      action: phase === Phase.PromptPicker ? 'exit' : 'exit',
      handler: () => {
        if (phase === Phase.Running) {
          // Abort any in-flight stream so the SDK call shuts down cleanly
          // before we tear the screen down.
          runAbortRef.current?.abort();
          dismiss();
        } else if (phase === Phase.PromptPicker) {
          dismiss();
        }
      },
    },
    {
      // `[p]` is the primary "pick new prompt" hotkey during Running —
      // works whether the stream is in flight or already finished. Always
      // returns to the PromptPicker (aborting the stream if necessary).
      match: 'p',
      label: 'p',
      action: 'pick new prompt',
      handler: () => {
        if (phase !== Phase.Running) return;
        runAbortRef.current?.abort();
        setPhase(Phase.PromptPicker);
      },
    },
  ]);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginTop={1} flexDirection="column">
        {phase === Phase.Choose && (
          <ChoosePhase error={loginError} onSelect={handleChoice} />
        )}

        {phase === Phase.Authenticating && (
          <AuthenticatingPhase loginUrl={session.loginUrl} />
        )}

        {phase === Phase.PromptPicker && (
          <>
            <Box marginBottom={1}>
              <Text bold color={Colors.accent}>
                MCP tutorial
              </Text>
            </Box>
            <PromptPickerPhase
              promptKit={kit}
              userDisplayName={session.apiUser?.first_name || null}
              onSelect={handlePromptPick}
            />
          </>
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
  error: string | null;
  onSelect: (value: ChoiceValue | ChoiceValue[]) => void;
}

const ChoosePhase = ({ error, onSelect }: ChoosePhaseProps) => (
  <Box flexDirection="column">
    <Text bold color={Colors.accent}>
      PostHog MCP
    </Text>

    <Box marginTop={1}>
      <Text>
        With MCP your agent works directly with the PostHog platform. You can
        prompt it to:
      </Text>
    </Box>

    <Box marginTop={1} flexDirection="column">
      <Text>
        <Text color="cyan">{Icons.diamond}</Text> Build dashboards
      </Text>
      <Text>
        <Text color="cyan">{Icons.diamond}</Text> Run SQL queries
      </Text>
      <Text>
        <Text color="cyan">{Icons.diamond}</Text> Deploy feature flags
      </Text>
      <Text>
        <Text color="cyan">{Icons.diamond}</Text> Debug exceptions and errors
      </Text>
    </Box>

    <Box marginTop={1}>
      <Text>Want a live demo using real data from your project?</Text>
    </Box>

    <Box>
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
  userDisplayName: string | null;
  onSelect: (value: string | string[]) => void;
}

const PromptPickerPhase = ({
  promptKit,
  userDisplayName,
  onSelect,
}: PromptPickerPhaseProps) => {
  const options = promptKit.map((p) => ({
    label: p.prompt,
    value: p.prompt,
  }));

  // Sequence: typewriter greeting → typewriter prompt → live PickerMenu.
  // The PickerMenu mounts only when the sequencer reaches it, so keyboard
  // input doesn't capture until the picker is actually on screen.
  const blocks: ContentBlock[] = [
    {
      content: `Hello there, ${userDisplayName || 'there'}!`,
      mode: TextRevealMode.Typewriter,
      animationInterval: 100,
      pause: 1200,
      dimWhenComplete: false,
    },
    {
      content: 'Pick a prompt to see the PostHog MCP in action.',
      mode: TextRevealMode.Typewriter,
      animationInterval: 50,
      pause: 1000,
      dimWhenComplete: false,
    },
    {
      content: (
        <>
          <PickerMenu
            options={options}
            optionMarginBottom={1}
            onSelect={onSelect}
          />
          <Box marginTop={2}>
            <Text>
              <Text bold>[esc]</Text>
              <Text> to exit</Text>
            </Text>
          </Box>
        </>
      ),
      persist: true,
    },
  ];

  return (
    <Box flexDirection="column">
      <ContentSequencer
        blocks={blocks}
        mode={TextRevealMode.Typewriter}
        blockInterval={350}
      />
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

  // When finished, the user has already seen the streaming progress —
  // collapse to just the agent's final message. Drop tool-call /
  // tool-result chatter and the "Prompt: <prompt>" header so the
  // message fills the viewport.
  const visibleChunks = finished
    ? chunks.filter((c) => c.kind === 'text' || c.kind === 'error')
    : chunks;

  // Hard cap: if Claude ignored the terminal-fit system prompt and
  // produced an overlong response, slice to the last N lines so the
  // result still fits without scroll. The system prompt should keep this
  // off most of the time — this is the belt-and-suspenders fallback.
  const cappedChunks = finished ? capTextChunks(visibleChunks) : visibleChunks;

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>Prompt:</Text> <Text color={Colors.accent}>{prompt}</Text>
      </Text>

      <Box marginTop={1} gap={1}>
        {/* Spinner spins for the full duration of the stream — from
            kickoff until the agent emits its final `done` chunk (or an
            error). Visual confirmation that work is still in flight even
            during pauses between chunks. */}
        {!finished && <Spinner />}
        <Text bold={finished}>
          {finished
            ? errorChunk
              ? `Failed after ${elapsed}s.`
              : `Done in ${elapsed}s.`
            : 'Streaming from PostHog MCP'}
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {cappedChunks.map((chunk, idx) => (
          <ChunkLine key={idx} chunk={chunk} />
        ))}
      </Box>
    </Box>
  );
};

/**
 * Belt-and-suspenders fallback for runs where Claude ignored the
 * terminal-fit system prompt and produced an overlong response. Joins
 * all text chunks, slices to the last N lines that fit in the current
 * terminal, and prepends an indicator showing how many lines got cut.
 * Errors are preserved separately so failures don't disappear into the
 * truncation.
 */
function capTextChunks(chunks: AgentChunk[]): AgentChunk[] {
  const rows = process.stdout.rows ?? 24;
  // Reserve rows for: title bar, prompt header (hidden when finished but
  // counted defensively), "Done in Xs." line, margins. The leftover is
  // what the message area can use.
  const maxMessageRows = Math.max(6, rows - 8);

  const textChunks = chunks.filter((c) => c.kind === 'text');
  const errors = chunks.filter((c) => c.kind === 'error');
  if (textChunks.length === 0) return chunks;

  const joined = textChunks.map((c) => c.text).join('');
  const lines = joined.split('\n');
  if (lines.length <= maxMessageRows) return chunks;

  const hidden = lines.length - maxMessageRows;
  const tail = lines.slice(-maxMessageRows).join('\n');

  return [
    {
      kind: 'text',
      text: `[${hidden} line${
        hidden === 1 ? '' : 's'
      } above — expand terminal to see more]\n\n${tail}`,
    },
    ...errors,
  ];
}

interface ChunkLineProps {
  chunk: AgentChunk;
}

const ChunkLine = ({ chunk }: ChunkLineProps) => {
  if (chunk.kind === 'text') {
    return <Text>{chunk.text}</Text>;
  }
  if (chunk.kind === 'tool-call') {
    return (
      <Text>
        {'  '}
        <Text color="cyan">↳ {chunk.toolName}</Text>
        {chunk.detail ? ` ${chunk.detail}` : ''}
      </Text>
    );
  }
  if (chunk.kind === 'tool-result') {
    return (
      <Text>
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
