/**
 * McpSuggestedPromptsScreen — shown after MCP install succeeds in the
 * standalone `wizard mcp add` program, and as the entry point for
 * `wizard mcp tutorial`.
 *
 * Phases:
 *   1. Choose          — opens with a Log in / Exit picker, framed by a
 *                        teaser of what MCP can do.
 *   2. Authenticating  — runs `services.performLogin()` (OAuth in
 *                        production, canned values in the playground).
 *                        Renders a spinner + login URL inline while the
 *                        promise is pending. Errors return to Choose
 *                        with an inline error line.
 *   3. Greeting        — role-tuned welcome via `getRoleGreeting`. A
 *                        ContentSequencer animates the headline,
 *                        bullets, and outro, then hands off to
 *                        PromptPicker. Only fires once per session
 *                        (returning via `[p]` skips it).
 *   4. PromptPicker    — lists the role-tailored kit from
 *                        `getRolePrompts`; user picks one to run.
 *   5. Running         — streams the agent's response inline via
 *                        `services.runPromptStreaming`. Text chunks
 *                        typewrite in; tool calls and results render
 *                        as styled badges. `[esc]` aborts; `[p]`
 *                        returns to the picker. On `done`/`error`,
 *                        auto-advances to FollowUp.
 *   6. FollowUp        — surfaces 3 context-aware next prompts inferred
 *                        from the last tool the agent used (via
 *                        `getFollowUps`), plus an explicit exit.
 *                        Picking a follow-up re-enters Running; the
 *                        conversation tree grows as deep as
 *                        MAX_PROMPT_RUNS allows.
 *
 * Credentials are guaranteed non-null once Greeting / PromptPicker /
 * Running / FollowUp are reached (the Choose → Authenticating gate
 * forces a successful login first). A defensive throw protects the
 * Running useEffect against a state-machine bug.
 */

import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  getRolePrompts,
  getRoleGreeting,
  getFollowUps,
  getToolHint,
  getCrossSellPrompts,
  FOLLOW_UP_EXIT_SENTINEL,
  type SuggestedPrompt,
  type RoleGreeting,
  type CrossSellPrompt,
} from '@lib/mcp-role-prompts';
import type { Integration } from '@lib/constants';
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
  Greeting = 'greeting',
  PromptPicker = 'prompt-picker',
  Running = 'running',
  FollowUp = 'follow-up',
  /** Final beat on every dismissal — reminds the user how to keep
   *  talking to PostHog after the tutorial ends. */
  Goodbye = 'goodbye',
  Done = 'done',
}

enum ChoiceValue {
  Login = 'login',
  Exit = 'exit',
}

// Cap how many prompts a single tutorial session can run, including
// follow-ups. Once reached, FollowUp shows a cap-reached state and the
// only escape is [esc]. Keeps the wizard from becoming a free-tier MCP
// front-end and gives the tutorial a natural "done" point.
const MAX_PROMPT_RUNS = 5;

export const McpSuggestedPromptsScreen = ({
  store,
  services,
}: McpSuggestedPromptsScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const session = store.session;
  // Role + framework family drive the kit, greeting, and cross-sell
  // prompts. All helpers fall back to neutral defaults when either
  // input is missing, so these are always populated.
  const kit = getRolePrompts(session.roleAtOrganization, session.integration);
  const crossSell = useMemo(
    () => getCrossSellPrompts(session.roleAtOrganization),
    [session.roleAtOrganization],
  );
  const greeting = useMemo(
    () => getRoleGreeting(session.roleAtOrganization),
    [session.roleAtOrganization],
  );

  const [phase, setPhase] = useState<Phase>(Phase.Choose);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [runningPrompt, setRunningPrompt] = useState<string | null>(null);
  const [runChunks, setRunChunks] = useState<AgentChunk[]>([]);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  // Frozen elapsed-seconds value, set the moment the stream emits
  // 'done' / 'error'. Without this, the "Done in Xs." line ticks up
  // every render once the result is parked under the FollowUp picker.
  const [runDurationSecs, setRunDurationSecs] = useState<number | null>(null);
  // Count every prompt the user has selected this session (including ones
  // they aborted mid-stream). Counted at pick-time, not completion-time,
  // so a user can't tap-cancel-tap-cancel to bypass the cap.
  const [runCount, setRunCount] = useState(0);
  const canPickAnother = runCount < MAX_PROMPT_RUNS;

  // The last tool the agent invoked during the current run. Drives the
  // context-aware follow-up suggestions in FollowUp. Cleared at the
  // start of each new run.
  const [lastToolName, setLastToolName] = useState<string | null>(null);
  // Every prompt the user has picked this session — initial + follow-ups.
  // Used to filter out already-seen suggestions in getFollowUps().
  const [branchHistory, setBranchHistory] = useState<string[]>([]);

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
        setPhase(Phase.Greeting);
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

  // Stream the chosen prompt against the agent. On terminal chunks
  // ('done' or 'error') we schedule a short delay before swapping into
  // FollowUp so the user gets a beat to read the final text.
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
    setLastToolName(null);
    setRunDurationSecs(null);

    const finishStream = (
      kind: 'done' | 'error',
      durationMs: number,
      errorText?: string,
    ) => {
      if (controller.signal.aborted) return;
      setRunDurationSecs(Math.round(durationMs / 1000));
      if (kind === 'done') {
        analytics.wizardCapture('mcp suggested prompts run', {
          prompt: runningPrompt,
          durationMs,
        });
      } else {
        analytics.wizardCapture('mcp suggested prompts run failed', {
          prompt: runningPrompt,
          error: errorText,
        });
      }
      // Transition immediately — the result chunks stay visible above
      // the FollowUp picker, so the user reads at their own pace
      // instead of waiting for an auto-advance timer.
      setPhase(Phase.FollowUp);
    };

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
          if (chunk.kind === 'tool-call') {
            setLastToolName(chunk.toolName);
          }
          if (chunk.kind === 'done') {
            finishStream('done', Date.now() - startedAt);
            return;
          }
          if (chunk.kind === 'error') {
            finishStream('error', Date.now() - startedAt, chunk.text);
            return;
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        const text = err instanceof Error ? err.message : String(err);
        setRunChunks((prev) => [...prev, { kind: 'error', text }]);
        finishStream('error', Date.now() - startedAt, text);
      }
    })();

    return () => {
      controller.abort();
      if (runAbortRef.current === controller) runAbortRef.current = null;
    };
  }, [phase, runningPrompt, services, session.credentials]);

  // Two-stage exit so the user always sees the Goodbye reminder
  // (installed clients + sample prompts) before the screen actually
  // tears down. `enterGoodbye` routes any dismissal into the reminder;
  // `closeWizard` does the actual store mutation that lets the router
  // move on.
  const enterGoodbye = (): void => {
    runAbortRef.current?.abort();
    setPhase(Phase.Goodbye);
  };

  const closeWizard = (): void => {
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
      enterGoodbye();
    }
  };

  // Single entry-point for kicking off a stream. Used by both the
  // initial picker and the follow-up picker.
  const startRun = (prompt: string): void => {
    setRunningPrompt(prompt);
    setRunCount((c) => c + 1);
    setBranchHistory((h) => [...h, prompt]);
    setPhase(Phase.Running);
  };

  const handlePromptPick = (value: string | string[]): void => {
    const picked = Array.isArray(value) ? value[0] : value;
    startRun(picked);
  };

  const handleFollowUpPick = (value: string | string[]): void => {
    const picked = Array.isArray(value) ? value[0] : value;
    if (picked === FOLLOW_UP_EXIT_SENTINEL) {
      analytics.wizardCapture('mcp suggested prompts follow-up', {
        choice: 'exit',
        depth: branchHistory.length,
      });
      enterGoodbye();
      return;
    }
    analytics.wizardCapture('mcp suggested prompts follow-up', {
      choice: 'continue',
      depth: branchHistory.length,
      lastToolName,
    });
    startRun(picked);
  };

  // `[enter]` skips the auto-paced Greeting to the picker. Only
  // registered while Greeting is on screen — PickerMenu owns enter
  // during the picker phases, and Running auto-transitions on done
  // (no auto-advance timer left to short-circuit).
  const canSkipForward = phase === Phase.Greeting;

  useKeyBindings('mcp-suggested-prompts', [
    {
      match: KeyMatch.Escape,
      label: 'esc',
      action: phase === Phase.Goodbye ? 'close' : 'exit',
      handler: () => {
        if (phase === Phase.Goodbye) {
          closeWizard();
        } else if (
          phase === Phase.Running ||
          phase === Phase.PromptPicker ||
          phase === Phase.FollowUp ||
          phase === Phase.Greeting
        ) {
          enterGoodbye();
        }
      },
    },
    {
      // `[p]` is the primary "pick a different prompt" hotkey during
      // Running and FollowUp — always returns to the PromptPicker
      // (aborting the stream if necessary). No-op once the per-session
      // cap is reached.
      match: 'p',
      label: 'p',
      action: canPickAnother ? 'pick new prompt' : 'cap reached',
      handler: () => {
        if (phase !== Phase.Running && phase !== Phase.FollowUp) return;
        if (!canPickAnother) return;
        runAbortRef.current?.abort();
        setPhase(Phase.PromptPicker);
      },
    },
    // Conditional enter binding — only active during the Greeting
    // (where it short-circuits the typewriter pacing). PickerMenu
    // owns enter in the picker phases; Running flips straight to
    // FollowUp the moment the stream completes.
    ...(canSkipForward
      ? [
          {
            match: KeyMatch.Return,
            label: 'enter',
            action: 'continue',
            handler: () => {
              setPhase(Phase.PromptPicker);
            },
          },
        ]
      : []),
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

        {phase === Phase.Greeting && (
          <GreetingPhase
            greeting={greeting}
            userDisplayName={session.apiUser?.first_name || null}
            onComplete={() => setPhase(Phase.PromptPicker)}
          />
        )}

        {phase === Phase.PromptPicker && (
          <PromptPickerPhase
            promptKit={kit}
            crossSell={crossSell}
            onSelect={handlePromptPick}
          />
        )}

        {phase === Phase.Running && runningPrompt && (
          <RunningPhase
            prompt={runningPrompt}
            chunks={runChunks}
            startedAt={runStartedAt}
            frozenDurationSecs={runDurationSecs}
            runCount={runCount}
            maxRuns={MAX_PROMPT_RUNS}
          />
        )}

        {phase === Phase.FollowUp && (
          <Box flexDirection="column">
            {runningPrompt && (
              <RunningPhase
                prompt={runningPrompt}
                chunks={runChunks}
                startedAt={runStartedAt}
                frozenDurationSecs={runDurationSecs}
                runCount={runCount}
                maxRuns={MAX_PROMPT_RUNS}
              />
            )}
            <Box marginTop={1}>
              <FollowUpPhase
                lastToolName={lastToolName}
                lastPrompt={runningPrompt}
                chunks={runChunks}
                role={session.roleAtOrganization}
                branchHistory={branchHistory}
                canPickAnother={canPickAnother}
                runCount={runCount}
                maxRuns={MAX_PROMPT_RUNS}
                onSelect={handleFollowUpPick}
              />
            </Box>
          </Box>
        )}

        {phase === Phase.Goodbye && (
          <GoodbyePhase
            installedClients={session.mcpInstalledClients}
            role={session.roleAtOrganization}
            integration={session.integration}
            engaged={branchHistory.length > 0}
            onClose={closeWizard}
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
      <Text>
        <Text color="cyan">{Icons.diamond}</Text> And lots more...
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

// ── Greeting phase ─────────────────────────────────────────────────────

interface GreetingPhaseProps {
  greeting: RoleGreeting;
  userDisplayName: string | null;
  onComplete: () => void;
}

const GreetingPhase = ({
  greeting,
  userDisplayName,
  onComplete,
}: GreetingPhaseProps) => {
  // Sequence: optional first-name greeting → role-tuned headline →
  // bullets reveal line-by-line → outro fades in → handoff to picker.
  //
  // Pacing notes: `pause` is the time the sequencer waits AFTER a
  // block finishes before advancing — that's the user's reading
  // window. Each typed block is "ready to read" only after the
  // typewriter finishes, so the pauses are sized for the absorbed
  // length, not the typing time.
  const blocks: ContentBlock[] = [];

  if (userDisplayName) {
    blocks.push({
      content: `Hi ${userDisplayName}!`,
      mode: TextRevealMode.Typewriter,
      animationInterval: 70,
      pause: 1200,
    });
  }

  blocks.push({
    content: greeting.headline,
    mode: TextRevealMode.Typewriter,
    animationInterval: 45,
    pause: 2000,
  });

  blocks.push({
    type: 'lines',
    lines: greeting.bullets.map((bullet, i) => (
      <Text key={i}>
        <Text color={Colors.primary}>{Icons.diamond}</Text>{' '}
        <Text dimColor>{bullet}</Text>
      </Text>
    )),
    interval: 700,
    pause: 2200,
  });

  blocks.push({
    content: greeting.outro,
    mode: TextRevealMode.Typewriter,
    animationInterval: 38,
    pause: 1800,
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={Colors.accent}>
          MCP tutorial
        </Text>
      </Box>
      <ContentSequencer
        blocks={blocks}
        mode={TextRevealMode.Typewriter}
        blockInterval={500}
        onSequenceComplete={onComplete}
      />
    </Box>
  );
};

// ── Prompt picker phase ────────────────────────────────────────────────

interface PromptPickerPhaseProps {
  promptKit: SuggestedPrompt[];
  crossSell: CrossSellPrompt[];
  onSelect: (value: string | string[]) => void;
}

const PromptPickerPhase = ({
  promptKit,
  crossSell,
  onSelect,
}: PromptPickerPhaseProps) => {
  // Cross-sell prompts get prefixed with "Try {Product}" so they stand
  // out in the flat picker. They share the same picker so arrow keys
  // flow naturally across both sections.
  const crossSellOptions = crossSell.map((c) => ({
    label: `Try ${c.product}  —  ${c.prompt}`,
    value: c.prompt,
  }));
  const kitOptions = promptKit.map((p) => ({
    label: p.prompt,
    value: p.prompt,
  }));
  const options = [...crossSellOptions, ...kitOptions];

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={Colors.accent}>
          MCP tutorial
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text>Pick a prompt to see the PostHog MCP in action.</Text>
      </Box>
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
    </Box>
  );
};

// ── Running phase ──────────────────────────────────────────────────────

interface RunningPhaseProps {
  prompt: string;
  chunks: AgentChunk[];
  startedAt: number | null;
  /** Set the instant the stream finishes; freezes the displayed elapsed
   *  time so re-renders under FollowUp don't keep ticking it forward. */
  frozenDurationSecs: number | null;
  runCount: number;
  maxRuns: number;
}

const RunningPhase = ({
  prompt,
  chunks,
  startedAt,
  frozenDurationSecs,
  runCount,
  maxRuns,
}: RunningPhaseProps) => {
  const isDone = chunks.some((c) => c.kind === 'done');
  const errorChunk = chunks.find((c) => c.kind === 'error');
  const finished = isDone || !!errorChunk;
  const elapsed =
    frozenDurationSecs ??
    (startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0);

  // Hard cap: if Claude ignored the terminal-fit system prompt and
  // produced an overlong response, slice text to the last N lines so the
  // result still fits without scroll. Tool calls / results are preserved.
  const visibleChunks = finished ? capTextChunks(chunks) : chunks;

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>Prompt:</Text> <Text color={Colors.accent}>{prompt}</Text>
      </Text>

      <Box marginTop={1} gap={1}>
        {/* Spinner spins for the full duration of the stream — visual
            confirmation that work is still in flight even during pauses
            between chunks. */}
        {!finished && <Spinner />}
        <Text bold={finished}>
          {finished
            ? errorChunk
              ? `Failed after ${elapsed}s.`
              : `Done in ${elapsed}s.`
            : 'Streaming from PostHog MCP'}
        </Text>
        <Text dimColor>
          ({runCount}/{maxRuns} prompts)
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {visibleChunks.map((chunk, idx) => (
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
 * terminal, prepends an indicator showing how many lines got cut.
 * Tool calls, results, and errors are preserved separately so they
 * don't disappear into the truncation.
 */
function capTextChunks(chunks: AgentChunk[]): AgentChunk[] {
  const rows = process.stdout.rows ?? 24;
  // Reserve rows for: title bar, prompt header, status line, the
  // FollowUp recap + picker + footer that now sits directly under
  // the result, plus margins. Stay generous so picker options aren't
  // pushed off-screen on shorter terminals.
  const maxMessageRows = Math.max(4, rows - 18);

  const textChunks = chunks.filter(
    (c): c is Extract<AgentChunk, { kind: 'text' }> => c.kind === 'text',
  );
  const nonTextChunks = chunks.filter(
    (c) => c.kind !== 'text' && c.kind !== 'done',
  );
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
    ...nonTextChunks,
  ];
}

interface ChunkLineProps {
  chunk: AgentChunk;
}

const ChunkLine = ({ chunk }: ChunkLineProps) => {
  if (chunk.kind === 'text') {
    // Text chunks render as plain text — the chunk-by-chunk arrival
    // from the stream IS the reveal animation. Adding a per-chunk
    // typewriter on top stacks animations in parallel and creates
    // visual noise when chunks arrive faster than they can type.
    return <Text>{chunk.text}</Text>;
  }
  if (chunk.kind === 'tool-call') {
    return (
      <Box
        marginTop={1}
        paddingX={1}
        borderStyle="round"
        borderColor={Colors.primary}
      >
        <Text color={Colors.primary} bold>
          {Icons.diamond}
        </Text>
        <Text> {chunk.toolName}</Text>
        {chunk.detail ? <Text dimColor> · {chunk.detail}</Text> : null}
      </Box>
    );
  }
  if (chunk.kind === 'tool-result') {
    // Every tool that completes earns a cross-product hint — turns each
    // agent action into a quiet product-tour beat without breaking flow.
    const hint = getToolHint(chunk.toolName);
    return (
      <Box flexDirection="column">
        <Box marginLeft={2}>
          <Text color={Colors.success}>{Icons.check}</Text>
          <Text dimColor> {chunk.detail || 'ok'}</Text>
        </Box>
        {hint && (
          <Box marginLeft={4}>
            <Text color={Colors.primary}>{Icons.triangleSmallRight}</Text>
            <Text dimColor>
              {' '}
              <Text bold>{hint.product}:</Text> {hint.text}
            </Text>
          </Box>
        )}
      </Box>
    );
  }
  if (chunk.kind === 'error') {
    return (
      <Box
        marginTop={1}
        paddingX={1}
        borderStyle="round"
        borderColor={Colors.error}
      >
        <Text color={Colors.error}>
          {Icons.warning} {chunk.text}
        </Text>
      </Box>
    );
  }
  // 'done' — no visual chunk; the status line above already reflects it.
  return null;
};

// ── Follow-up phase ────────────────────────────────────────────────────

interface FollowUpPhaseProps {
  lastToolName: string | null;
  lastPrompt: string | null;
  chunks: AgentChunk[];
  role: string | null;
  branchHistory: string[];
  canPickAnother: boolean;
  runCount: number;
  maxRuns: number;
  onSelect: (value: string | string[]) => void;
}

const FollowUpPhase = ({
  lastToolName,
  lastPrompt,
  chunks,
  role,
  branchHistory,
  canPickAnother,
  runCount,
  maxRuns,
  onSelect,
}: FollowUpPhaseProps) => {
  const followUps = useMemo(
    () =>
      getFollowUps({
        lastToolName,
        lastPrompt: lastPrompt || '',
        role,
        branchHistory,
      }),
    [lastToolName, lastPrompt, role, branchHistory],
  );

  // When the cap is reached, only the exit entry is available.
  const options = canPickAnother
    ? followUps.map((f) => ({ label: f.label, value: f.prompt }))
    : [{ label: 'Exit', value: FOLLOW_UP_EXIT_SENTINEL }];

  const errorChunk = chunks.find((c) => c.kind === 'error');
  const recap = errorChunk
    ? 'That one errored out — try a different angle?'
    : lastToolName
    ? `That used \`${lastToolName}\`. Want to keep digging?`
    : 'Want to keep exploring?';

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={Colors.accent}>
          What next?
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text>{recap}</Text>
      </Box>
      <PickerMenu
        options={options}
        optionMarginBottom={1}
        onSelect={onSelect}
      />
      <Box marginTop={2} flexDirection="column">
        <Text dimColor>
          ({runCount}/{maxRuns} prompts used)
        </Text>
        {!canPickAnother && (
          <Text dimColor>
            You&apos;ve hit the {maxRuns}-prompt tutorial cap.
          </Text>
        )}
        {canPickAnother && (
          <Text>
            <Text bold>[p]</Text>
            <Text> to pick a different prompt</Text>
            <Text>{'  '}</Text>
            <Text bold>[esc]</Text>
            <Text> to exit</Text>
          </Text>
        )}
      </Box>
    </Box>
  );
};

// ── Goodbye phase ──────────────────────────────────────────────────────
// Always shown before final dismissal. Reminds the user where MCP is
// available and what to ask once they're back in their IDE.

interface GoodbyePhaseProps {
  installedClients: string[];
  role: string | null;
  integration: Integration | null;
  /** True if the user actually ran at least one prompt this session. */
  engaged: boolean;
  onClose: () => void;
}

const GoodbyePhase = ({
  installedClients,
  role,
  integration,
  engaged,
  onClose,
}: GoodbyePhaseProps) => {
  // Take 3 starter prompts from the role-tailored kit. These act as
  // "next time you open your IDE, try this" reminders.
  const kit = getRolePrompts(role, integration);
  const samples = kit.slice(0, 3);

  const headline = engaged
    ? 'Nice work. You can keep talking to PostHog anytime.'
    : "You're all set — PostHog MCP is here when you're ready.";

  const introLine =
    installedClients.length > 0 ? (
      <Text>
        MCP is set up in{' '}
        <Text bold color={Colors.primary}>
          {installedClients.join(', ')}
        </Text>
        . Open one and try a prompt like:
      </Text>
    ) : (
      <Text>
        Wherever you have MCP set up (Claude Code, Cursor, VS Code, Windsurf,
        Zed, etc.), open the agent and try a prompt like:
      </Text>
    );

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={Colors.accent}>
          {headline}
        </Text>
      </Box>

      <Box marginBottom={1}>{introLine}</Box>

      <Box marginBottom={1} flexDirection="column">
        {samples.map((p, i) => (
          <Box key={i}>
            <Text color={Colors.primary}>{Icons.triangleSmallRight}</Text>
            <Text> </Text>
            <Text dimColor>{p.prompt}</Text>
          </Box>
        ))}
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>
          Re-run this tutorial anytime with{' '}
          <Text bold>npx @posthog/wizard mcp tutorial</Text>.
        </Text>
      </Box>

      <PickerMenu
        options={[{ label: 'Close', value: 'close' }]}
        onSelect={onClose}
      />
    </Box>
  );
};
