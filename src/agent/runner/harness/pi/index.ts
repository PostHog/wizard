/**
 * The `pi` backend — the challenger. Drives pi.dev's coding agent
 * (`@earendil-works/pi-coding-agent`) against the PostHog LLM gateway, behind
 * `wizard-orchestrator`. It owns the agent loop and model transport; prompt
 * assembly, error routing, and the outro stay in `linear.ts`, shared with the
 * `anthropic` control.
 *
 * Transport: the gateway is registered as an `anthropic-messages` provider
 * (same protocol the claude-agent-sdk path uses), bearer auth, Bedrock-fallback
 * + wizard metadata/flag headers, model id matched to `anthropic` for a clean
 * A/B. Security parity (canUseTool + YARA) and skills/MCP discovery are
 * follow-ups (#525, #524 skills) — v1 uses pi's built-in coding tools.
 */

import fs from 'fs';
import path from 'path';
import { getLogFilePath, logToFile } from '@utils/debug';
import {
  Harness,
  Sequence,
  WIZARD_REMARK_EVENT_NAME,
  WIZARD_USER_AGENT,
} from '@shared/constants';
import { analytics } from '@utils/analytics';
import { AgentErrorType } from '@agent/agent-interface';
import { AgentSignals, REMARK_INSTRUCTION } from '@agent/signals';
import { AgentOutputSignals } from '@agent/output-signals';
import { assembleCommandments } from '../../switchboard/commandments';
import { gatewayAuth, type GatewayAuth } from '@agent/gateway-session';
import {
  buildGatewayProvider,
  GATEWAY_PROVIDER,
  withGatewayRemint,
} from './gateway';
import { createAioCapture } from '@agent/aio-capture';
import type {
  AgentResult,
  AgentHarness,
  BackendRunInputs,
  TaskRunInputs,
} from '../types';
import type { BootstrapResult } from '@agent/runner/shared/types';
import type { ProgressEmitter } from '@agent/progress';
import { createEmitLog } from '@agent/runner/shared/progress-collector';
import type { TaskStore } from './tasks';
import { completionFailure, runErrorType } from './completion';
import { bindPiCancellation } from './cancellation';
import { structuredOutputExtension } from './structured-output';
import { classifyRunFailure, ErrorCodes } from '@shared/errors';

/** Injects the MCP server `instructions` pi-mcp-adapter drops (project env, skill steer, tool domains) into the system prompt, falling back to a bootstrap-derived project block when the warm-connect captured none. */
function piMcpContext(
  boot: BootstrapResult,
  instructions?: string,
  posthogMcp = true,
): string {
  // No tool, no block. The fallback below names `posthog_exec`, so emitting it
  // after a failed handshake points the agent at a tool that is not registered.
  if (!posthogMcp) return '';
  if (instructions) {
    // Heading + verbatim server instructions (see PR #862 for a full sample).
    return ['', '## PostHog MCP server', instructions].join('\n');
  }
  const project = boot.project?.name
    ? `${boot.project.name} (id ${boot.credentials.projectId})`
    : `id ${boot.credentials.projectId}`;
  // Fallback: a `## PostHog project` block with name/id, host, region.
  return [
    '',
    '## PostHog project',
    'Your `posthog_exec` calls run against this project:',
    `- Project: ${project}`,
    `- Host: ${boot.credentials.host.apiHost}`,
    `- Region: ${boot.credentials.host.region}`,
  ].join('\n');
}

/**
 * The ONLY environment variables pi's tool subprocesses (bash → npm/pip/…) are
 * allowed to see. Everything else — every secret (POSTHOG_PERSONAL_API_KEY,
 * ANTHROPIC_*, AWS_*), every ambient credential, the parent process's whole env
 * — is dropped before a child is spawned. pi's own gateway auth is programmatic
 * (the access token never lives in env), so a minimal env costs the agent
 * nothing while closing the leak that exposed the key before. Kept to what a
 * package manager genuinely needs to run.
 */
const ALLOWED_SUBPROCESS_ENV_KEYS = [
  'PATH',
  'HOME',
  'SHELL',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'TERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
];

/** A fresh subprocess env holding only the allowlisted keys present in process.env. */
export function buildScrubbedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ALLOWED_SUBPROCESS_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * Tag a tool with an execution mode (mutates + returns it). Read-only tools are
 * `parallel` so a single turn that batches independent reads/searches runs them
 * at once; mutating/install tools are `sequential` so a batch never races writes
 * or concurrent installs. pi-agent-core runs a batch in parallel only when no
 * tool in it is `sequential`.
 */
export function withMode<T>(tool: T, mode: 'sequential' | 'parallel'): T {
  (tool as { executionMode?: 'sequential' | 'parallel' }).executionMode = mode;
  return tool;
}

/** Pull plain text out of a pi AgentMessage (content is text/image blocks). */
export function extractText(message: unknown): string {
  const content = (message as { content?: unknown })?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: string; text: string } => {
        const block = c as { type?: string; text?: unknown };
        return block?.type === 'text' && typeof block.text === 'string';
      })
      .map((c) => c.text)
      .join('');
  }
  return '';
}

/**
 * Surface `[DASHBOARD_URL]` / `[NOTEBOOK_URL]` markers the agent prints (after
 * the MCP creates them) into the outro link, mirroring the anthropic path's
 * signal parsing (#9). The marker carries the URL the MCP returned.
 */
export function applyOutroMarkers(
  textBlock: string,
  emit: ProgressEmitter,
): void {
  const markers: Array<[string, (url: string) => void]> = [
    [
      AgentSignals.DASHBOARD_URL,
      (url) => emit({ kind: 'url', which: 'dashboard', url }),
    ],
    [
      AgentSignals.NOTEBOOK_URL,
      (url) => emit({ kind: 'url', which: 'notebook', url }),
    ],
  ];
  for (const [marker, apply] of markers) {
    const idx = textBlock.indexOf(marker);
    if (idx === -1) continue;
    const url = textBlock
      .slice(idx + marker.length)
      .trim()
      .split(/\s/)[0];
    if (url) apply(url);
  }
}

/**
 * The text of the last `[STATUS] …` line in a block, if any. Last wins so the
 * spinner shows the most recent action when a turn prints several.
 */
export function lastStatusLine(textBlock: string): string | undefined {
  let status: string | undefined;
  for (const line of textBlock.split('\n')) {
    const idx = line.indexOf(AgentSignals.STATUS);
    if (idx !== -1) {
      status = line.slice(idx + AgentSignals.STATUS.length).trim();
    }
  }
  return status || undefined;
}

/** Cap on completion-guard re-prompts while tasks remain open (see the run loop). */
const MAX_CONTINUE_NUDGES = 20;

/** Nudge re-sent when the agent stops early with tasks still open. */
const CONTINUE_INSTRUCTION =
  'You still have open tasks in your list (not all are marked `completed`). Do not stop — pick up the next `in_progress` or `pending` task and keep working until every task is `completed`. Continue now.';

/** True while any task in the store is not yet `completed`. */
function hasOpenTasks(store: TaskStore): boolean {
  for (const t of store.values()) if (t.status !== 'completed') return true;
  return false;
}

export const piBackend: AgentHarness = {
  name: Harness.pi,

  async run(inputs: BackendRunInputs): Promise<AgentResult> {
    if (inputs.signal?.aborted) {
      return {
        kind: 'abort',
        classification: AgentErrorType.ABORT,
        message: 'Agent run cancelled',
      };
    }
    const {
      config: runConfig,
      input,
      boot,
      emit,
      prompt,
      spinner,
      structured,
    } = inputs;
    const config = runConfig.run;
    const modelId = inputs.model;
    const log = createEmitLog(emit);

    const capture = createAioCapture({
      enabled: input.flags.captureAio,
      projectApiKey: boot.credentials.projectApiKey,
      apiHost: boot.credentials.host.apiHost,
      runTags: boot.wizardMetadata,
    });

    // Init banner (parity #5).
    if (!structured) {
      log.step('Initializing Wizard agent...');
      log.step(`Verbose logs: ${getLogFilePath()}`);
      log.success("Agent initialized. Let's get cooking!");
    }

    spinner.start(config.spinnerMessage ?? 'Customizing your PostHog setup...');

    // Same `agent completed`/`agent aborted` shape as anthropic.
    const startTime = Date.now();
    const signals = new AgentOutputSignals();
    let assistantTurns = 0;
    let lastAssistantText = '';
    // Tool calls across the whole run. Zero means the agent only ever produced
    // text and never acted — a no-op that leaves the project untouched.
    let toolCalls = 0;
    const runDurations = () => {
      const durationMs = Date.now() - startTime;
      return {
        duration_ms: durationMs,
        duration_seconds: Math.round(durationMs / 1000),
      };
    };
    // How this run failed: the closed AgentErrorType it is about to return.
    // Without it every terminal path below — a security termination, a no-op
    // run, a plan left open, a rate limit, a gateway error — arrived as the
    // same unlabelled event, so a run that died could be counted but not
    // diagnosed. Only two of those are errors; the rest are an enforcement
    // stop and two agent behaviours, hence "failure mode" over "error".
    //
    // Not `reason`: the linear sequence emits this same event with a `reason`
    // holding the agent's free-text [ABORT] string, and one property cannot be
    // both a closed enum and unbounded prose without making either unreadable.
    const captureAborted = (failureMode: AgentErrorType) =>
      analytics.wizardCapture('agent aborted', {
        failure_mode: failureMode,
        ...runDurations(),
        model: modelId,
      });
    const timedOutResult = (timeoutMs: number): AgentResult => {
      spinner.stop('Agent run timed out');
      captureAborted(AgentErrorType.AGENTIC_DETECTION_TIMEOUT);
      return {
        kind: 'failure',
        classification: AgentErrorType.AGENTIC_DETECTION_TIMEOUT,
        message: `Agent run timed out after ${timeoutMs / 1000}s`,
      };
    };

    let mcpCleanup: (() => void) | undefined;
    let aioFailed = true;
    let cancellation: ReturnType<typeof bindPiCancellation> | undefined;
    let timedOut = false;
    let timeoutAbort: Promise<void> | undefined;
    try {
      const {
        createAgentSession,
        DefaultResourceLoader,
        SessionManager,
        AuthStorage,
        ModelRegistry,
        getAgentDir,
        createLsToolDefinition,
        createFindToolDefinition,
        createGrepToolDefinition,
        createBashToolDefinition,
        createReadToolDefinition,
        createEditToolDefinition,
        createWriteToolDefinition,
      } = await import('@earendil-works/pi-coding-agent');

      // the claude-agent-sdk path. The provider spec is shared with the
      // orchestrator's per-task sessions (gateway.ts). gatewayAuth mints the
      // run's scoped token.
      const refreshAuth = () =>
        gatewayAuth(
          boot.credentials.host,
          boot.credentials.accessToken,
          boot.programId,
        );
      const auth = await refreshAuth();
      const providerInputs = (current: GatewayAuth) => ({
        gatewayUrl: current.gatewayUrl,
        accessToken: current.token,
        teamId: current.teamId,
        wizardMetadata: boot.wizardMetadata,
        wizardFlags: boot.wizardFlags,
        modelId,
        effort: inputs.thinkingLevel,
      });
      const { provider, caps, api } = buildGatewayProvider(
        providerInputs(auth),
      );
      const registry = ModelRegistry.inMemory(AuthStorage.create());
      registry.registerProvider(GATEWAY_PROVIDER, provider as never);

      const model = registry.find(GATEWAY_PROVIDER, modelId);
      if (!model) {
        return {
          kind: 'failure',
          classification: AgentErrorType.API_ERROR,
          message: 'pi: gateway model could not be resolved',
        };
      }

      // System prompt = wizard commandments. Skip project context files /
      // user extensions / skills so the run is hermetic; skills discovery is a
      // follow-up (#524).
      //
      // Fail-closed security (#525): an extension intercepts EVERY tool call —
      // built-in and custom — and reuses the anthropic policy (canUseTool
      // allowlist + .env fencing + YARA). `noExtensions: true` only suppresses
      // disk-discovered extensions; explicit `extensionFactories` still load,
      // so the fence is on while the target project can't inject its own.
      // Shared flag: true while a wizard_ask overlay is open. The ask tool
      // flips it; the security gate reads it to block Write/Edit meanwhile.
      const askState = { pending: false };

      const { createSecurityExtension } = await import('./security');
      const security = createSecurityExtension({
        disallowedTools: runConfig.disallowedTools,
        getWizardAskPending: () => askState.pending,
        triageProvider: boot.triageProvider,
        // Where pi's bash runs; the rm allowance is confined to this tree.
        workingDirectory: input.installDir,
      });

      // Pay warlock's WASM-init + rule-compile cost now, off the tool-call
      // path, so the first scanned call doesn't eat cold-start latency.
      const { prewarmYaraScanner } = await import('@agent/yara-hooks');
      void prewarmYaraScanner();

      // Wire the real PostHog MCP into pi (#10): load pi's MCP adapter and point
      // it at the hosted MCP the anthropic path uses, so dashboards/insights are
      // created through the sanctioned MCP. Best-effort — if it can't load or
      // connect, the run continues (minus the dashboard step) rather than failing
      // the whole integration. The security factory is always first.
      const extensionFactories = [security.factory] as Array<
        (pi: unknown) => void
      >;
      let mcpInstructions: string | undefined;
      // Whether the agent really got the tool. The commandments below claim
      // `posthog_exec` exists when this is true, so it must track the setup and
      // not the intent — a hardcoded `true` told the agent to call a tool the
      // failed handshake never registered. `task.ts` has always done this.
      let posthogMcp = false;
      try {
        const { setupPostHogMcp, fetchInstructions } = await import('./mcp');
        // Overlaps the network handshake with the adapter's jiti load.
        const instructionsPromise = fetchInstructions(
          boot.credentials.host.mcpUrl,
          boot.credentials.accessToken,
          WIZARD_USER_AGENT,
        );
        const mcp = await setupPostHogMcp({
          mcpUrl: boot.credentials.host.mcpUrl,
          accessToken: boot.credentials.accessToken,
          userAgent: WIZARD_USER_AGENT,
        });
        extensionFactories.push(mcp.extensionFactory);
        mcpCleanup = mcp.cleanup;
        mcpInstructions = await instructionsPromise;
        posthogMcp = true;
      } catch (err) {
        try {
          mcpCleanup?.();
        } catch {
          /* Setup cleanup is best effort. */
        }
        mcpCleanup = undefined;
        logToFile(`[pi] PostHog MCP setup skipped: ${String(err)}`);
        analytics.wizardCapture('mcp setup failed', {
          harness: 'pi',
          scope: 'run',
          error: String(err).slice(0, 300),
        });
      }

      if (structured) {
        extensionFactories.push(
          structuredOutputExtension(structured.schema, api),
        );
      }

      const resourceLoader = new DefaultResourceLoader({
        cwd: input.installDir,
        agentDir: getAgentDir(),
        systemPrompt:
          assembleCommandments({
            program: runConfig.programId,
            sequence: Sequence.linear,
            harness: Harness.pi,
            caps: { bash: true, posthogMcp },
          }) +
          '\n' +
          piMcpContext(boot, mcpInstructions, posthogMcp),
        noExtensions: true,
        noSkills: true,
        noContextFiles: true,
        noPromptTemplates: true,
        noThemes: true,
        extensionFactories,
      });
      await resourceLoader.reload();

      // Wizard capabilities as custom tools (pi has no MCP): skill
      // discovery/install + fenced .env edits, same names as the MCP server so
      // the shared prompt is unchanged. pi's built-in Read/Write/Edit/Bash do
      // the code changes. Loaded lazily — it pulls in typebox (ESM), which must
      // stay out of the static module graph so CommonJS unit tests can load the
      // backend seam without parsing it.
      const { createWizardPiTools } = await import('./tools');
      const { createWizardPiTaskTools } = await import('./tasks');
      const { createDispatchAgentTool } = await import('./subagent');
      // Created once so the run loop can read the store for the completion guard.
      const wizardTaskTools = createWizardPiTaskTools((tasks) =>
        emit({ kind: 'tasks', tasks }),
      );
      // The one bash the agent (and its subagents) may use: every subprocess it
      // spawns gets a scrubbed env, so no secret or ambient variable reaches an
      // `npm install`. Shared with the subagent so the lockdown is inherited.
      const scrubbedBash = withMode(
        createBashToolDefinition(input.installDir, {
          spawnHook: (ctx) => ({ ...ctx, env: buildScrubbedEnv() }),
        }),
        'sequential',
      );

      const customTools = [
        // Built-ins re-registered explicitly. `noTools: 'builtin'` disables pi's
        // defaults so we can supply the env-scrubbed bash above; read/edit/write
        // are the stock definitions. Reads run in parallel so a batched turn of
        // independent reads executes at once; edit/write/bash stay sequential.
        withMode(createReadToolDefinition(input.installDir), 'parallel'),
        withMode(createEditToolDefinition(input.installDir), 'sequential'),
        withMode(createWriteToolDefinition(input.installDir), 'sequential'),
        scrubbedBash,
        // Native ls/find/grep so the agent explores with proper tools instead
        // of fence-blocked `bash {ls/find}` (the profiled retry-spirals came
        // from this gap). Parallel — exploration batches cleanly.
        withMode(createLsToolDefinition(input.installDir), 'parallel'),
        withMode(createFindToolDefinition(input.installDir), 'parallel'),
        withMode(createGrepToolDefinition(input.installDir), 'parallel'),
        ...createWizardPiTools({
          workingDirectory: input.installDir,
          skillsBaseUrl: boot.skillsBaseUrl,
          triageProvider: boot.triageProvider,
          emit,
          detectPackageManager: config.detectPackageManager,
          // The host ask bridge — lets interactive programs (self-driving) ask
          // the user through pi. Threaded from the runner, same path as the
          // anthropic harness. Absent in CI → the tool errors on call.
          askBridge: inputs.askBridge,
          maxQuestions: config.maxQuestions,
          onAskPendingChange: (pending) => {
            askState.pending = pending;
          },
          // Skip wizard_ask when the program disallows it (bare pi tool names
          // don't match the MCP-prefixed disallow list at the security gate).
          disallowedTools: runConfig.disallowedTools,
        }),
        // Task/todo tools (#526): render the todo list live in the TUI, parity
        // with the anthropic path.
        ...wizardTaskTools.tools,
        // Controlled subagent dispatch (#526): a nested fenced session with a
        // read-only toolset and no dispatch_agent of its own, so it can't
        // escape the fence or recurse.
        createDispatchAgentTool({
          model,
          modelRegistry: registry,
          cwd: input.installDir,
          agentDir: getAgentDir(),
          securityFactory: security.factory as (pi: unknown) => void,
          bashTool: scrubbedBash,
          sdk: { createAgentSession, DefaultResourceLoader, SessionManager },
        }),
      ];

      const { session: agentSession } = await createAgentSession({
        model,
        modelRegistry: registry,
        // Reasoning effort from the switchboard capability matrix (undefined =
        // pi's default). Sent as `reasoning_effort` for openai-completions.
        thinkingLevel: caps.thinkingLevel,
        cwd: input.installDir,
        sessionManager: SessionManager.inMemory(input.installDir),
        resourceLoader,
        // Disable the default built-in tools; `customTools` re-registers
        // read/edit/write + an env-scrubbed bash, so no subprocess inherits the
        // host env. Custom + extension tools stay enabled.
        noTools: 'builtin',
        customTools,
      });

      // Fire the extension lifecycle — what interactive mode does via
      // rebindCurrentSession. createAgentSession builds the session but does not
      // emit session_start on its own, and the MCP adapter connects on that
      // event; without this its tools report "MCP not initialized".
      cancellation = bindPiCancellation(
        inputs.signal,
        agentSession,
        (error) => {
          logToFile(`[pi] abort failed: ${String(error)}`);
        },
      );
      await agentSession.bindExtensions({});

      // A turn that ends on a 401 from an aged bearer re-mints once and
      // continues; pi resolves the provider's apiKey per request, so
      // re-registering is enough.
      const turns = withGatewayRemint({
        signal: inputs.signal,
        session: agentSession,
        registry,
        auth,
        refreshAuth,
        providerInputs,
        continueText: CONTINUE_INSTRUCTION,
        onRemint: () => {
          logToFile('[pi] gateway token renewed after a 401; continuing');
          analytics.wizardCapture('gateway token reminted', { harness: 'pi' });
        },
      });

      // Map pi events onto the run spinner + the log file, mirroring the
      // anthropic path's log shape (assistant turns + tool I/O) and driving the
      // single run spinner with one stable status at a time (no overlap).
      const unsubscribe = agentSession.subscribe((event) => {
        // Mirror the turn into AIO. No-op when --capture-aio is off. Runs
        // before the role guard so the module's own filter (assistant-only)
        // stays the single source of truth for what's captured.
        capture.captureFromPiMessageEndEvent(event);

        switch (event.type) {
          case 'message_end': {
            // User prompts also emit message_end; only assistant turns count.
            if ((event.message as { role?: string })?.role !== 'assistant') {
              break;
            }
            assistantTurns += 1;
            turns.noteAssistantTurn(event.message);
            const assistant = extractText(event.message).trim();
            lastAssistantText = assistant;
            if (structured) {
              inputs.middleware?.onMessage({
                type: 'assistant',
                message: { content: [{ type: 'text', text: assistant }] },
              });
            }
            if (assistant) {
              logToFile(`[pi] assistant: ${assistant.slice(0, 1000)}`);
              applyOutroMarkers(assistant, emit);
              // Surface [STATUS] lines into the live spinner + status history,
              // mirroring the anthropic path — pi otherwise drops them.
              const statusText = lastStatusLine(assistant);
              if (statusText) {
                emit({ kind: 'status', message: statusText });
                spinner.message(statusText);
              }
              for (const line of assistant.split('\n')) signals.push(line);
            }
            break;
          }
          case 'tool_execution_start': {
            toolCalls += 1;
            const args = JSON.stringify(event.args ?? {}).slice(0, 200);
            logToFile(`[pi] → ${event.toolName} ${args}`);
            if (structured) {
              inputs.middleware?.onMessage({
                type: 'assistant',
                message: {
                  content: [
                    {
                      type: 'tool_use',
                      name: event.toolName,
                      input: event.args,
                    },
                  ],
                },
              });
            }
            // Don't surface raw tool names in the spinner — the anthropic path
            // doesn't, and it reads as noise. The Task panel (syncTodos) is the
            // visible progress, matching the anthropic presentation.
            break;
          }
          case 'tool_execution_end': {
            // Log every result in full, matching the anthropic path's
            // SDK-message logging. Call-only logs make failed runs
            // undiagnosable: a tool can fail (or return something the model
            // misreads) with no trace of what came back.
            logToFile(
              `[pi] ${event.isError ? '✗' : '←'} ${event.toolName}: ${
                typeof event.result === 'string'
                  ? event.result
                  : JSON.stringify(event.result ?? '')
              }`,
            );
            break;
          }
          case 'agent_end': {
            logToFile(`[pi] agent_end (willRetry=${String(event.willRetry)})`);
            break;
          }
          default:
            break;
        }
      });

      // Seed AIO capture with the initial prompt so the first assistant
      // turn's `$ai_input` includes it — pi's subscribe stream doesn't emit
      // a message_end for the initial prompt, only for tool_result user
      // turns that follow.
      capture.setInitialPrompt(prompt);

      let terminal = turns.terminalFailure();
      // A structured run's budget starts once setup is done.
      const timeout =
        structured &&
        setTimeout(() => {
          timedOut = true;
          timeoutAbort = agentSession.abort().catch((error: unknown) => {
            logToFile(`[pi] timeout abort failed: ${String(error)}`);
          });
        }, structured.timeoutMs);
      try {
        if (inputs.signal?.aborted)
          return {
            kind: 'abort',
            classification: AgentErrorType.ABORT,
            message: 'Agent run cancelled',
          };
        // Non-streaming: resolves when the agent run completes. Throws if no
        // model/api key, or on a transport error.
        await turns.prompt(prompt);
        terminal = turns.terminalFailure();

        // Completion guard: pi's prompt() resolves the moment the model returns
        // a turn with no tool call (e.g. a lone [STATUS] line), even mid-plan.
        // While tasks remain open and we're under the cap, nudge it to continue.
        // A schema-bound scan has no plan to finish, so it never gets nudged.
        let continueNudges = 0;
        while (
          !structured &&
          continueNudges < MAX_CONTINUE_NUDGES &&
          !security.state.criticalViolation &&
          !inputs.signal?.aborted &&
          !terminal &&
          hasOpenTasks(wizardTaskTools.store)
        ) {
          continueNudges += 1;
          logToFile(
            `[pi] completion guard: tasks still open, nudge ${continueNudges}/${MAX_CONTINUE_NUDGES}`,
          );
          await turns.prompt(CONTINUE_INSTRUCTION);
          terminal = turns.terminalFailure();
        }

        // Best-effort remark ask — a failed turn never fails a successful run.
        if (
          !structured &&
          !security.state.criticalViolation &&
          !terminal &&
          !inputs.signal?.aborted
        ) {
          try {
            await agentSession.prompt(REMARK_INSTRUCTION);
          } catch (err) {
            logToFile(`[pi] remark request failed: ${String(err)}`);
          }
        }
      } finally {
        if (timeout) clearTimeout(timeout);
        try {
          unsubscribe();
        } catch {
          /* Keep the terminal result. */
        }
      }

      if (inputs.signal?.aborted) {
        return {
          kind: 'abort',
          classification: AgentErrorType.ABORT,
          message: 'Agent run cancelled',
        };
      }
      if (timedOut && structured) return timedOutResult(structured.timeoutMs);

      if (terminal && !security.state.criticalViolation) {
        spinner.stop(
          config.errorMessage ?? `${config.integrationLabel} failed`,
        );
        captureAborted(terminal.classification);
        if (terminal.status === 401) {
          return {
            kind: 'decided_failure',
            failure: {
              code: ErrorCodes.AuthInvalidOrExpired,
              message: 'Authentication failed (401)',
              detail: { providerMessage: terminal.message },
            },
          };
        }
        return terminal.classification === AgentErrorType.ABORT
          ? {
              kind: 'abort',
              classification: AgentErrorType.ABORT,
              message: terminal.message,
            }
          : {
              kind: 'failure',
              classification: terminal.classification,
              message: terminal.message,
            };
      }

      // A latched post-scan violation terminates the run as a YARA violation,
      // matching the anthropic path's AgentErrorType.YARA_VIOLATION.
      if (security.state.criticalViolation) {
        spinner.stop('Security violation detected');
        logToFile(
          `[pi] terminated: YARA violation (blocked ${security.state.blockedCount} call(s))`,
        );
        captureAborted(AgentErrorType.YARA_VIOLATION);
        return {
          kind: 'failure',
          classification: AgentErrorType.YARA_VIOLATION,
        };
      }

      // pi ends a run on any tool-call-less turn, so guard against a hollow
      // success reaching the outro (nothing done, or stopped mid-plan).
      const openTasks = !structured && hasOpenTasks(wizardTaskTools.store);
      const failure = completionFailure({ toolCalls, openTasks });
      if (failure === AgentErrorType.NO_PROGRESS) {
        spinner.stop('Agent made no changes');
        logToFile(
          `[pi] no progress: ${assistantTurns} assistant turn(s), 0 tool calls`,
        );
        analytics.wizardCapture('agent no progress', {
          assistant_turns: assistantTurns,
        });
        captureAborted(failure);
        return { kind: 'failure', classification: failure };
      }
      if (failure === AgentErrorType.INCOMPLETE_TASKS) {
        spinner.stop('Agent stopped before finishing');
        logToFile('[pi] incomplete: tasks left open');
        analytics.wizardCapture('agent incomplete tasks', { open_tasks: true });
        captureAborted(failure);
        return { kind: 'failure', classification: failure };
      }

      const remark = signals.remark();
      if (remark) {
        analytics.capture(WIZARD_REMARK_EVENT_NAME, { remark });
      }

      // A failed install_skill is non-fatal — the agent continues best-effort
      // without the skill — but every such run must be measurable.
      const skillFailure = signals.skillInstallFailure();
      if (skillFailure !== undefined) {
        analytics.wizardCapture('agent continued without skill', {
          detail: skillFailure,
        });
      }

      // The skill plans events into .posthog-events.json then asks to remove it
      // on completion; pi's `rm` is fence-blocked, so the agent can't — clean it
      // up host-side rather than leave a stale (often empty) artifact (#15).
      try {
        const planFile = path.join(input.installDir, '.posthog-events.json');
        if (!structured && fs.existsSync(planFile))
          await fs.promises.rm(planFile);
      } catch (err) {
        logToFile(`[pi] .posthog-events.json cleanup skipped: ${String(err)}`);
      }

      const stats = agentSession.getSessionStats();
      analytics.wizardCapture('agent completed', {
        ...runDurations(),
        model: modelId,
        num_turns: assistantTurns,
        // API-reported tokens only; no total_cost_usd — the API returns no
        // cost, and $ai_generation already prices the run authoritatively.
        input_tokens: stats.tokens.input,
        output_tokens: stats.tokens.output,
        cache_creation_input_tokens: stats.tokens.cacheWrite,
        cache_read_input_tokens: stats.tokens.cacheRead,
      });
      spinner.stop(config.successMessage ?? 'PostHog integration complete');
      aioFailed = false;
      if (!structured) return { kind: 'success' };
      try {
        return {
          kind: 'success',
          structuredOutput: JSON.parse(lastAssistantText),
        };
      } catch {
        // The caller validates the result and owns its bounded retry.
        return { kind: 'success' };
      }
    } catch (err) {
      if (inputs.signal?.aborted) {
        return {
          kind: 'abort',
          classification: AgentErrorType.ABORT,
          message: 'Agent run cancelled',
        };
      }
      if (timedOut && structured) return timedOutResult(structured.timeoutMs);
      const message = err instanceof Error ? err.message : String(err);
      logToFile(`[pi] run error: ${message}`);
      spinner.stop(config.errorMessage ?? `${config.integrationLabel} failed`);
      log.error(`pi backend error: ${message}`);
      const coded = classifyRunFailure(err);
      if (coded.coded && err instanceof Error) {
        captureAborted(AgentErrorType.API_ERROR);
        return {
          kind: 'decided_failure',
          failure: { code: coded.code, message: coded.message, error: err },
        };
      }
      const classification = runErrorType(message);
      captureAborted(classification);
      return {
        kind: 'failure',
        classification,
        message,
        error: err instanceof Error ? err : undefined,
      };
    } finally {
      await cancellation?.settle();
      await timeoutAbort;
      try {
        mcpCleanup?.();
      } catch {
        /* Keep the terminal result. */
      }
      try {
        capture.finishPiRun(aioFailed);
      } catch {
        /* Telemetry is best effort. */
      }
    }
  },

  // Orchestrator mode: one fresh pi session per seed plan / drained task, with
  // the in-process queue tools registered as pi custom tools. Lazily imported —
  // task.ts pulls in typebox (ESM), which must stay out of the static module
  // graph so CommonJS unit tests can load the backend seam without parsing it.
  async runTask(inputs: TaskRunInputs): Promise<AgentResult> {
    const { runPiTask } = await import('./task');
    return runPiTask(inputs);
  },
};
