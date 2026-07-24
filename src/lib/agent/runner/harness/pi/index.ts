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
import { getUI } from '@ui';
import { getLogFilePath, logToFile } from '@utils/debug';
import {
  Harness,
  Sequence,
  WIZARD_REMARK_EVENT_NAME,
  WIZARD_USER_AGENT,
} from '@lib/constants';
import { piRuntimeNotes } from './runtime-notes';
import { analytics } from '@utils/analytics';
import { AgentErrorType } from '@lib/agent/agent-interface';
import { AgentSignals, REMARK_INSTRUCTION } from '@lib/agent/signals';
import { AgentOutputSignals } from '@lib/agent/output-signals';
import { getWizardCommandments } from '@lib/agent/commandments';
import { piProgramGuidance } from './program-guidance';
import { buildGatewayProvider, GATEWAY_PROVIDER } from './gateway';
import type {
  AgentResult,
  AgentHarness,
  BackendRunInputs,
  TaskRunInputs,
} from '../types';
import type { BootstrapResult } from '@lib/agent/runner/shared/types';
import type { TaskStore } from './tasks';
import { completionFailure } from './completion';

/** Injects the MCP server `instructions` pi-mcp-adapter drops (project env, skill steer, tool domains) into the system prompt, falling back to a bootstrap-derived project block when the warm-connect captured none. */
function piMcpContext(boot: BootstrapResult, instructions?: string): string {
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
export function applyOutroMarkers(textBlock: string): void {
  const markers: Array<[string, (url: string) => void]> = [
    [AgentSignals.DASHBOARD_URL, (url) => getUI().setDashboardUrl(url)],
    [AgentSignals.NOTEBOOK_URL, (url) => getUI().setNotebookUrl(url)],
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
    const { session, boot, prompt, spinner, config, programConfig } = inputs;
    const modelId = inputs.model;

    // Init banner (parity #5).
    getUI().log.step('Initializing Wizard agent...');
    getUI().log.step(`Verbose logs: ${getLogFilePath()}`);
    getUI().log.success("Agent initialized. Let's get cooking!");

    spinner.start(config.spinnerMessage ?? 'Customizing your PostHog setup...');

    // Same `agent completed`/`agent aborted` shape as anthropic.
    const startTime = Date.now();
    const signals = new AgentOutputSignals();
    let assistantTurns = 0;
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
    const captureAborted = () =>
      analytics.wizardCapture('agent aborted', {
        ...runDurations(),
        model: modelId,
      });

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
      // orchestrator's per-task sessions (gateway.ts).
      const { provider, caps, gatewayUrl } = buildGatewayProvider({
        gatewayUrl: boot.credentials.host.gatewayUrl,
        accessToken: boot.credentials.accessToken,
        wizardMetadata: boot.wizardMetadata,
        wizardFlags: boot.wizardFlags,
        modelId,
        effort: inputs.thinkingLevel,
      });
      const registry = ModelRegistry.inMemory(AuthStorage.create());
      registry.registerProvider(GATEWAY_PROVIDER, provider as never);

      const model = registry.find(GATEWAY_PROVIDER, modelId);
      if (!model) {
        return {
          error: AgentErrorType.API_ERROR,
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
        disallowedTools: programConfig.disallowedTools,
        getWizardAskPending: () => askState.pending,
        // Triage speaks the Anthropic messages API (it appends /v1/messages),
        // so it gets the bare gateway URL regardless of which API shape the
        // agent's model uses. Without this, pi has no ANTHROPIC_* env (it
        // auths programmatically) and triage would silently no-op.
        triageAuth: {
          baseURL: gatewayUrl,
          authToken: boot.credentials.accessToken,
        },
        // Where pi's bash runs; the rm allowance is confined to this tree.
        workingDirectory: session.installDir,
      });

      // Pay warlock's WASM-init + rule-compile cost now, off the tool-call
      // path, so the first scanned call doesn't eat cold-start latency.
      const { prewarmYaraScanner } = await import('@lib/yara-hooks');
      void prewarmYaraScanner();

      // Wire the real PostHog MCP into pi (#10): load pi's MCP adapter and point
      // it at the hosted MCP the anthropic path uses, so dashboards/insights are
      // created through the sanctioned MCP. Best-effort — if it can't load or
      // connect, the run continues (minus the dashboard step) rather than failing
      // the whole integration. The security factory is always first.
      const extensionFactories = [security.factory] as Array<
        (pi: unknown) => void
      >;
      let mcpCleanup: (() => void) | undefined;
      let mcpInstructions: string | undefined;
      try {
        const { setupPostHogMcp } = await import('./mcp');
        const mcp = await setupPostHogMcp({
          agentDir: getAgentDir(),
          mcpUrl: boot.credentials.host.mcpUrl,
          accessToken: boot.credentials.accessToken,
          userAgent: WIZARD_USER_AGENT,
        });
        extensionFactories.push(mcp.extensionFactory);
        mcpCleanup = mcp.cleanup;
        mcpInstructions = mcp.instructions;
      } catch (err) {
        logToFile(`[pi] PostHog MCP setup skipped: ${String(err)}`);
      }

      const resourceLoader = new DefaultResourceLoader({
        cwd: session.installDir,
        agentDir: getAgentDir(),
        systemPrompt:
          getWizardCommandments() +
          '\n\n' +
          piRuntimeNotes(Sequence.linear, { bash: true, posthogMcp: true }) +
          piProgramGuidance(programConfig.id) +
          '\n' +
          piMcpContext(boot, mcpInstructions),
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
      const wizardTaskTools = createWizardPiTaskTools();
      // The one bash the agent (and its subagents) may use: every subprocess it
      // spawns gets a scrubbed env, so no secret or ambient variable reaches an
      // `npm install`. Shared with the subagent so the lockdown is inherited.
      const scrubbedBash = withMode(
        createBashToolDefinition(session.installDir, {
          spawnHook: (ctx) => ({ ...ctx, env: buildScrubbedEnv() }),
        }),
        'sequential',
      );

      const customTools = [
        // Built-ins re-registered explicitly. `noTools: 'builtin'` disables pi's
        // defaults so we can supply the env-scrubbed bash above; read/edit/write
        // are the stock definitions. Reads run in parallel so a batched turn of
        // independent reads executes at once; edit/write/bash stay sequential.
        withMode(createReadToolDefinition(session.installDir), 'parallel'),
        withMode(createEditToolDefinition(session.installDir), 'sequential'),
        withMode(createWriteToolDefinition(session.installDir), 'sequential'),
        scrubbedBash,
        // Native ls/find/grep so the agent explores with proper tools instead
        // of fence-blocked `bash {ls/find}` (the profiled retry-spirals came
        // from this gap). Parallel — exploration batches cleanly.
        withMode(createLsToolDefinition(session.installDir), 'parallel'),
        withMode(createFindToolDefinition(session.installDir), 'parallel'),
        withMode(createGrepToolDefinition(session.installDir), 'parallel'),
        ...createWizardPiTools({
          workingDirectory: session.installDir,
          skillsBaseUrl: boot.skillsBaseUrl,
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
          disallowedTools: programConfig.disallowedTools,
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
          cwd: session.installDir,
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
        cwd: session.installDir,
        sessionManager: SessionManager.inMemory(session.installDir),
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
      await agentSession.bindExtensions({});

      // Map pi events onto the run spinner + the log file, mirroring the
      // anthropic path's log shape (assistant turns + tool I/O) and driving the
      // single run spinner with one stable status at a time (no overlap).
      const unsubscribe = agentSession.subscribe((event) => {
        switch (event.type) {
          case 'message_end': {
            // User prompts also emit message_end; only assistant turns count.
            if ((event.message as { role?: string })?.role !== 'assistant') {
              break;
            }
            assistantTurns += 1;
            const assistant = extractText(event.message).trim();
            if (assistant) {
              logToFile(`[pi] assistant: ${assistant.slice(0, 1000)}`);
              applyOutroMarkers(assistant);
              // Surface [STATUS] lines into the live spinner + status history,
              // mirroring the anthropic path — pi otherwise drops them.
              const statusText = lastStatusLine(assistant);
              if (statusText) {
                getUI().pushStatus(statusText);
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

      try {
        // Non-streaming: resolves when the agent run completes. Throws if no
        // model/api key, or on a transport error.
        await agentSession.prompt(prompt);

        // Completion guard: pi's prompt() resolves the moment the model returns
        // a turn with no tool call (e.g. a lone [STATUS] line), even mid-plan.
        // While tasks remain open and we're under the cap, nudge it to continue.
        let continueNudges = 0;
        while (
          continueNudges < MAX_CONTINUE_NUDGES &&
          !security.state.criticalViolation &&
          hasOpenTasks(wizardTaskTools.store)
        ) {
          continueNudges += 1;
          logToFile(
            `[pi] completion guard: tasks still open, nudge ${continueNudges}/${MAX_CONTINUE_NUDGES}`,
          );
          await agentSession.prompt(CONTINUE_INSTRUCTION);
        }

        // Best-effort remark ask — a failed turn never fails a successful run.
        if (!security.state.criticalViolation) {
          try {
            await agentSession.prompt(REMARK_INSTRUCTION);
          } catch (err) {
            logToFile(`[pi] remark request failed: ${String(err)}`);
          }
        }
      } finally {
        unsubscribe();
        mcpCleanup?.();
      }

      // A latched post-scan violation terminates the run as a YARA violation,
      // matching the anthropic path's AgentErrorType.YARA_VIOLATION.
      if (security.state.criticalViolation) {
        spinner.stop('Security violation detected');
        logToFile(
          `[pi] terminated: YARA violation (blocked ${security.state.blockedCount} call(s))`,
        );
        captureAborted();
        return { error: AgentErrorType.YARA_VIOLATION };
      }

      // pi ends a run on any tool-call-less turn, so guard against a hollow
      // success reaching the outro (nothing done, or stopped mid-plan).
      const openTasks = hasOpenTasks(wizardTaskTools.store);
      const failure = completionFailure({ toolCalls, openTasks });
      if (failure === AgentErrorType.NO_PROGRESS) {
        spinner.stop('Agent made no changes');
        logToFile(
          `[pi] no progress: ${assistantTurns} assistant turn(s), 0 tool calls`,
        );
        analytics.wizardCapture('agent no progress', {
          assistant_turns: assistantTurns,
        });
        captureAborted();
        return { error: failure };
      }
      if (failure === AgentErrorType.INCOMPLETE_TASKS) {
        spinner.stop('Agent stopped before finishing');
        logToFile('[pi] incomplete: tasks left open');
        analytics.wizardCapture('agent incomplete tasks', { open_tasks: true });
        captureAborted();
        return { error: failure };
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
        const planFile = path.join(session.installDir, '.posthog-events.json');
        if (fs.existsSync(planFile)) await fs.promises.rm(planFile);
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
      return {};
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logToFile(`[pi] run error: ${message}`);
      spinner.stop(config.errorMessage ?? `${config.integrationLabel} failed`);
      getUI().log.error(`pi backend error: ${message}`);
      captureAborted();

      const lower = message.toLowerCase();
      if (lower.includes('rate limit') || lower.includes('429')) {
        return { error: AgentErrorType.RATE_LIMIT, message };
      }
      return { error: AgentErrorType.API_ERROR, message };
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
