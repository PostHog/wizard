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
  getCrossSellPrompts,
  FOLLOW_UP_EXIT_SENTINEL,
  PINNED_FIRST_PROMPT,
  type PromptOption,
  type RoleGreeting,
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

// How long to hold the final streamed result on screen before swapping
// into FollowUp. Gives the user a beat to read the result before the
// picker mounts underneath. [esc] / [p] still work during the delay.
const FOLLOW_UP_DELAY_MS = 3000;

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

  // Phase.Choose is the no-commitment entry. Login fires only when the
  // user picks 'Start tutorial' — explicit consent for the OAuth dance.
  const [phase, setPhase] = useState<Phase>(Phase.Choose);
  const [loginError, setLoginError] = useState<string | null>(null);
  // Whether the user picked "Start MCP tutorial" — decides where a
  // successful login lands: Greeting for a started tutorial, Choose
  // for the up-front auth.
  const startedTutorialRef = useRef(false);
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
  // CLI mode's exec command string for the last tool call — recovers the inner
  // tool name so follow-ups stay context-aware under both server modes.
  const [lastToolCommand, setLastToolCommand] = useState<string | null>(null);
  // Every prompt the user has picked this session — initial + follow-ups.
  // Used to filter out already-seen suggestions in getFollowUps().
  const [branchHistory, setBranchHistory] = useState<string[]>([]);

  // AbortController for the in-flight runPromptStreaming call. Lifted
  // to a ref so [esc] / unmount can call abort() without the closure
  // needing to re-bind on every state change.
  const runAbortRef = useRef<AbortController | null>(null);

  // The Claude Agent SDK session ID of the most recent completed run.
  // Carried forward into follow-up runs via `resumeSessionId` so the
  // agent sees prior turns as context. Held in a ref so updating it
  // doesn't re-trigger the Running useEffect. Cleared whenever the
  // user returns to PromptPicker — that's a fresh conversation.
  const currentSessionIdRef = useRef<string | null>(null);

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
        setPhase(startedTutorialRef.current ? Phase.Greeting : Phase.Choose);
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
    setLastToolCommand(null);
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
      // Hold the final result on screen for a beat before swapping into
      // FollowUp, so the user has a moment to read without the picker
      // jumping in underneath. Guard via the abort controller so an
      // [esc] / [p] press inside the delay window cancels the swap.
      setTimeout(() => {
        if (controller.signal.aborted) return;
        setPhase(Phase.FollowUp);
      }, FOLLOW_UP_DELAY_MS);
    };

    void (async () => {
      const credentials = session.credentials;
      if (!credentials) return;
      try {
        for await (const chunk of services.runPromptStreaming({
          prompt: runningPrompt,
          credentials,
          signal: controller.signal,
          // Read at call-time so a session id captured by the previous
          // run carries into the follow-up. Null on a fresh start.
          resumeSessionId: currentSessionIdRef.current ?? undefined,
        })) {
          if (controller.signal.aborted) return;
          setRunChunks((prev) => [...prev, chunk]);
          if (chunk.kind === 'tool-call') {
            setLastToolName(chunk.toolName);
            setLastToolCommand(chunk.command ?? null);
          }
          if (chunk.kind === 'done') {
            // Remember the SDK session id so the next follow-up can
            // resume it. The SDK may issue a new id on resume — always
            // overwrite with the latest.
            if (chunk.sessionId) {
              currentSessionIdRef.current = chunk.sessionId;
            }
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
      startedTutorialRef.current = true;
      // Picking Start tutorial is the explicit OAuth consent moment.
      // If we somehow already have credentials, skip straight to Greeting.
      setPhase(session.credentials ? Phase.Greeting : Phase.Authenticating);
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
      action:
        phase === Phase.Goodbye
          ? 'close'
          : phase === Phase.Authenticating
          ? 'cancel'
          : 'exit',
      handler: () => {
        if (phase === Phase.Goodbye) {
          closeWizard();
        } else if (phase === Phase.Authenticating) {
          // Cancel the OAuth dance — the login effect's cleanup discards
          // the in-flight result. Choose still works without credentials.
          setPhase(Phase.Choose);
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
      // cap is reached. Clearing the session id here is what makes
      // the next pick a fresh conversation rather than a follow-up.
      match: 'p',
      label: 'p',
      action: canPickAnother ? 'pick new prompt' : 'cap reached',
      handler: () => {
        if (phase !== Phase.Running && phase !== Phase.FollowUp) return;
        if (!canPickAnother) return;
        runAbortRef.current?.abort();
        currentSessionIdRef.current = null;
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
          <Box flexDirection="column" flexGrow={1}>
            {/* Result area absorbs flex and shrinks first when the
                terminal is short. `capTextChunks` does the actual
                row-aware truncation; flexShrink here is belt-and-
                suspenders so Ink's layout never squeezes the picker. */}
            {runningPrompt && (
              <Box flexDirection="column" flexShrink={1}>
                <RunningPhase
                  prompt={runningPrompt}
                  chunks={runChunks}
                  startedAt={runStartedAt}
                  frozenDurationSecs={runDurationSecs}
                  runCount={runCount}
                  maxRuns={MAX_PROMPT_RUNS}
                />
              </Box>
            )}
            {/* Picker is pinned: flexShrink={0} means it never gives
                up rows to siblings. flexBasis="auto" keeps its
                natural height. */}
            <Box marginTop={1} flexShrink={0} flexDirection="column">
              <FollowUpPhase
                lastToolName={lastToolName}
                lastToolCommand={lastToolCommand}
                lastPrompt={runningPrompt}
                chunks={runChunks}
                role={session.roleAtOrganization}
                branchHistory={branchHistory}
                canPickAnother={canPickAnother}
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

const ChoosePhase = ({ error, onSelect }: ChoosePhaseProps) => {
  return (
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
};

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
  promptKit: PromptOption[];
  crossSell: PromptOption[];
  onSelect: (value: string | string[]) => void;
}

const PromptPickerPhase = ({
  promptKit,
  crossSell,
  onSelect,
}: PromptPickerPhaseProps) => {
  // PINNED_FIRST_PROMPT is the always-first option — a safe generic
  // read ("Show me my top 5 events from the last 7 days") that works
  // on any project regardless of role or setup. Cross-sells follow,
  // then the role kit. Dedupe by prompt text so the pinned entry
  // doesn't appear twice when the role kit also contains it. Cap at
  // 4 options total so the picker fits without scrolling.
  const seenPrompts = new Set<string>();
  const options = [PINNED_FIRST_PROMPT, ...crossSell, ...promptKit]
    .filter((o) => {
      if (seenPrompts.has(o.prompt)) return false;
      seenPrompts.add(o.prompt);
      return true;
    })
    .slice(0, 4)
    .map((o) => ({
      label: o.product
        ? `Try ${o.product}  —  ${o.label ?? o.prompt}`
        : o.label ?? o.prompt,
      value: o.prompt,
    }));

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

  // When finished, collapse to just the agent's final answer + any
  // error. The tool-call / tool-result chatter has already served its
  // purpose as a "work in progress" indicator. We also drop every text
  // block EXCEPT the last one — Sonnet often emits a "I'll query X…"
  // preamble alongside its first tool_use, and showing both the
  // preamble and the final answer doubles the noise above the picker.
  const visibleChunks = finished
    ? capTextChunks(collapseToFinalAnswer(chunks))
    : chunks;

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
 * Strip everything except the agent's final answer + any error chunks.
 * Drops tool-call / tool-result chatter (their work is done once the
 * stream completes) and any text blocks emitted BEFORE the last text
 * block — those are typically Sonnet's "I'll query X…" preamble that
 * arrives alongside the first tool_use and adds noise above the picker.
 *
 * If the run produced no text at all (pure tool calls, or only errors),
 * fall through to whatever chunks survived so the user isn't left with
 * a blank result.
 */
function collapseToFinalAnswer(chunks: AgentChunk[]): AgentChunk[] {
  const textChunks = chunks.filter((c) => c.kind === 'text');
  const errors = chunks.filter((c) => c.kind === 'error');
  if (textChunks.length === 0) return errors;
  // Keep only the last text block — that's the model's final answer.
  // Anything earlier was preamble emitted alongside tool_use.
  return [textChunks[textChunks.length - 1], ...errors];
}

/**
 * Belt-and-suspenders fallback for runs where Claude ignored the
 * terminal-fit system prompt and produced an overlong response. Joins
 * all text chunks, then walks them from the bottom keeping only as many
 * lines as fit in the visual row budget — wide lines that wrap to
 * multiple rows on a narrow terminal cost their wrapped row count, not
 * 1. Prepends an indicator showing how many source lines got cut. Tool
 * calls, results, and errors are preserved separately so they don't
 * disappear into the truncation.
 *
 * Visual-row-aware truncation is what makes the FollowUp picker feel
 * pinned: a 5-row table that wraps to 12 visual rows on a 60-col
 * terminal correctly counts as 12, so the cap leaves exactly the room
 * the picker needs.
 */
function capTextChunks(chunks: AgentChunk[]): AgentChunk[] {
  const rows = process.stdout.rows ?? 24;
  const cols = process.stdout.columns ?? 120;
  // Reserve rows for the FollowUp picker that sits below the result:
  // recap line, 4 picker options, marginTop, plus the prompt + status
  // chrome above the result and the global keyboard hints bar. Be
  // pessimistic — `process.stdout.rows` doesn't always match the actual
  // visible area (terminal padding, host UI chrome, etc.), and an
  // off-by-a-few rows shows up as the result overlapping the picker.
  // Better to leave the picker breathing room than risk overprint.
  const maxVisualRows = Math.max(3, rows - 19);

  const textChunks = chunks.filter((c) => c.kind === 'text');
  const errors = chunks.filter((c) => c.kind === 'error');
  if (textChunks.length === 0) return chunks;

  const joined = textChunks.map((c) => c.text).join('');
  const lines = joined.split('\n');

  // How many visual rows does this source line consume after wrap?
  // Empty lines still take 1; everything else is ceil(width / cols).
  const visualRows = (line: string): number =>
    Math.max(1, Math.ceil(line.length / cols));

  // Walk from the bottom, accumulating visual rows until budget runs
  // out, so we keep the tail of the message (which has the punchline).
  let used = 0;
  let keepFrom = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const cost = visualRows(lines[i]);
    if (used + cost > maxVisualRows) break;
    used += cost;
    keepFrom = i;
  }

  if (keepFrom === 0) return chunks;

  const hidden = keepFrom;
  const tail = lines.slice(keepFrom).join('\n');

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

// ── Follow-up phase ────────────────────────────────────────────────────

interface FollowUpPhaseProps {
  lastToolName: string | null;
  lastToolCommand: string | null;
  lastPrompt: string | null;
  chunks: AgentChunk[];
  role: string | null;
  branchHistory: string[];
  canPickAnother: boolean;
  maxRuns: number;
  onSelect: (value: string | string[]) => void;
}

const FollowUpPhase = ({
  lastToolName,
  lastToolCommand,
  lastPrompt,
  chunks,
  role,
  branchHistory,
  canPickAnother,
  maxRuns,
  onSelect,
}: FollowUpPhaseProps) => {
  const followUps = useMemo(
    () =>
      getFollowUps({
        lastToolName,
        lastToolCommand,
        lastPrompt: lastPrompt || '',
        role,
        branchHistory,
      }),
    [lastToolName, lastToolCommand, lastPrompt, role, branchHistory],
  );

  // When the cap is reached, only the exit entry is available. Follow-up
  // entries always set `label`; fall back to `prompt` defensively in case
  // a future contributor omits it.
  const options = canPickAnother
    ? followUps.map((f) => ({ label: f.label ?? f.prompt, value: f.prompt }))
    : [{ label: 'Exit', value: FOLLOW_UP_EXIT_SENTINEL }];

  const errorChunk = chunks.find((c) => c.kind === 'error');
  const recap = errorChunk
    ? 'That one errored out — try a different angle?'
    : !canPickAnother
    ? `You've hit the ${maxRuns}-prompt tutorial cap.`
    : `Want to keep exploring? Select a follow-up prompt.`;

  return (
    <Box flexDirection="column">
      <Text>{recap}</Text>
      <PickerMenu options={options} onSelect={onSelect} />
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
        onSelect={() => onClose()}
      />
    </Box>
  );
};
