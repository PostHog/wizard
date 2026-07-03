/**
 * The `pi` backend — the challenger. Drives pi.dev's coding agent
 * (`@earendil-works/pi-coding-agent`) against the PostHog LLM gateway, behind
 * `wizard-use-pi-harness`. It owns the agent loop and model transport; prompt
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
import { getLlmGatewayUrl } from '@utils/urls';
import {
  Harness,
  POSTHOG_FLAG_HEADER_PREFIX,
  POSTHOG_PROPERTY_HEADER_PREFIX,
  WIZARD_REMARK_EVENT_NAME,
  WIZARD_USER_AGENT,
} from '@lib/constants';
import { analytics } from '@utils/analytics';
import { AgentErrorType } from '@lib/agent/agent-interface';
import { AgentSignals, REMARK_INSTRUCTION } from '@lib/agent/signals';
import { AgentOutputSignals } from '@lib/agent/output-signals';
import { getWizardCommandments } from '@lib/agent/commandments';
import { runtimeNotes } from '../../switchboard/prompts';
import { modelCapabilities } from '../../switchboard/models';
import type { AgentResult, AgentHarness, BackendRunInputs } from '../types';

/** Provider registered on the in-memory registry for this run. */
const GATEWAY_PROVIDER = 'posthog-gateway';

/**
 * The gateway speaks two shapes on two endpoints: Anthropic models over
 * `anthropic-messages` (the SDK appends `/v1/messages`, so the base URL has no
 * `/v1`), and OpenAI-class models (`openai/gpt-5`, …) over OpenAI completions at
 * `/v1/chat/completions` (base URL keeps `/v1`). Infer the shape from the model
 * id so a pair's model selects the right transport.
 */
function gatewayApiFor(
  modelId: string,
): 'anthropic-messages' | 'openai-completions' {
  return modelId.startsWith('openai/')
    ? 'openai-completions'
    : 'anthropic-messages';
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
function withMode<T>(tool: T, mode: 'sequential' | 'parallel'): T {
  (tool as { executionMode?: 'sequential' | 'parallel' }).executionMode = mode;
  return tool;
}

/**
 * Gateway HTTP headers, mirroring `buildAgentEnv` on the anthropic path: always
 * the Bedrock-fallback header, plus wizard metadata (`X-POSTHOG-PROPERTY-*`) and
 * wizard feature flags (`X-POSTHOG-FLAG-*`).
 */
function buildGatewayHeaders(
  wizardMetadata: Record<string, string>,
  wizardFlags: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    'x-posthog-use-bedrock-fallback': 'true',
    // 1M context window, same as the anthropic edition — pi otherwise runs at
    // 200k and overflows on larger projects (the post-run compaction failures).
    'anthropic-beta': 'context-1m-2025-08-07',
  };
  for (const [key, value] of Object.entries(wizardMetadata)) {
    const name = key.startsWith(POSTHOG_PROPERTY_HEADER_PREFIX)
      ? key
      : `${POSTHOG_PROPERTY_HEADER_PREFIX}${key}`;
    headers[name] = value;
  }
  for (const [flagKey, variant] of Object.entries(wizardFlags)) {
    if (!flagKey.toLowerCase().startsWith('wizard')) continue;
    headers[POSTHOG_FLAG_HEADER_PREFIX + flagKey.toUpperCase()] = variant;
  }
  return headers;
}

/** Pull plain text out of a pi AgentMessage (content is text/image blocks). */
function extractText(message: unknown): string {
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
function applyOutroMarkers(textBlock: string): void {
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
    let editWriteCount = 0;
    let bashCount = 0;
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

      // Register the PostHog gateway. Auth is the posthog token as a bearer;
      // headers carry Bedrock-fallback + wizard metadata/flags — identical to
      // the claude-agent-sdk path. The transport shape is inferred from the
      // model id; OpenAI completions is served at `/v1/...`, so it keeps the
      // `/v1` the Anthropic SDK strips.
      const api = gatewayApiFor(modelId);
      const caps = modelCapabilities(modelId);
      const gatewayUrl = getLlmGatewayUrl(boot.host);
      const baseUrl =
        api === 'openai-completions' ? `${gatewayUrl}/v1` : gatewayUrl;
      const registry = ModelRegistry.inMemory(AuthStorage.create());
      registry.registerProvider(GATEWAY_PROVIDER, {
        name: 'PostHog Gateway',
        baseUrl,
        apiKey: boot.accessToken,
        authHeader: true,
        api,
        headers: buildGatewayHeaders(boot.wizardMetadata, boot.wizardFlags),
        models: [
          {
            id: modelId,
            name: `${modelId} (PostHog Gateway)`,
            api,
            // Whether to request reasoning effort is a model trait resolved by
            // the switchboard, not a harness guess: non-reasoning openai models
            // reject `reasoning_effort` (gpt-4o → gateway UnsupportedParamsError
            // → the run no-ops). The effort level rides on the session below.
            reasoning: caps.reasoning,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 1_000_000,
            maxTokens: 64_000,
          },
        ],
      });

      const model = registry.find(GATEWAY_PROVIDER, modelId);
      if (!model) {
        return {
          error: AgentErrorType.API_ERROR,
          message: 'pi: gateway model could not be resolved',
        };
      }
      logToFile(`[pi] gateway ${baseUrl} model ${modelId} (${api})`);

      // System prompt = wizard commandments. Skip project context files /
      // user extensions / skills so the run is hermetic; skills discovery is a
      // follow-up (#524).
      //
      // Fail-closed security (#525): an extension intercepts EVERY tool call —
      // built-in and custom — and reuses the anthropic policy (canUseTool
      // allowlist + .env fencing + YARA). `noExtensions: true` only suppresses
      // disk-discovered extensions; explicit `extensionFactories` still load,
      // so the fence is on while the target project can't inject its own.
      const { createSecurityExtension } = await import('./security');
      const security = createSecurityExtension({
        disallowedTools: programConfig.disallowedTools,
      });

      // Wire the real PostHog MCP into pi (#10): load pi's MCP adapter and point
      // it at the hosted MCP the anthropic path uses, so dashboards/insights are
      // created through the sanctioned MCP. Best-effort — if it can't load or
      // connect, the run continues (minus the dashboard step) rather than failing
      // the whole integration. The security factory is always first.
      const extensionFactories = [security.factory] as Array<
        (pi: unknown) => void
      >;
      let mcpCleanup: (() => void) | undefined;
      try {
        const { setupPostHogMcp } = await import('./mcp');
        const mcp = await setupPostHogMcp({
          agentDir: getAgentDir(),
          mcpUrl: boot.mcpUrl,
          accessToken: boot.accessToken,
          userAgent: WIZARD_USER_AGENT,
        });
        extensionFactories.push(mcp.extensionFactory);
        mcpCleanup = mcp.cleanup;
      } catch (err) {
        logToFile(`[pi] PostHog MCP setup skipped: ${String(err)}`);
      }

      const resourceLoader = new DefaultResourceLoader({
        cwd: session.installDir,
        agentDir: getAgentDir(),
        systemPrompt:
          getWizardCommandments() + '\n\n' + runtimeNotes(Harness.pi, modelId),
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
      const { tools: taskTools, store: taskStore } = createWizardPiTaskTools();
      const { createDispatchAgentTool } = await import('./subagent');
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
        }),
        // Task/todo tools (#526): render the todo list live in the TUI, parity
        // with the anthropic path. The store also drives the end-of-turn
        // completion guard below.
        ...taskTools,
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
            assistantTurns += 1;
            const assistant = extractText(event.message).trim();
            if (assistant) {
              logToFile(`[pi] assistant: ${assistant.slice(0, 1000)}`);
              applyOutroMarkers(assistant);
              for (const line of assistant.split('\n')) signals.push(line);
            }
            break;
          }
          case 'tool_execution_start': {
            if (event.toolName === 'edit' || event.toolName === 'write')
              editWriteCount += 1;
            if (event.toolName === 'bash') bashCount += 1;
            const args = JSON.stringify(event.args ?? {}).slice(0, 200);
            logToFile(`[pi] → ${event.toolName} ${args}`);
            // Don't surface raw tool names in the spinner — the anthropic path
            // doesn't, and it reads as noise. The Task panel (syncTodos) is the
            // visible progress, matching the anthropic presentation.
            break;
          }
          case 'tool_execution_end': {
            if (event.isError) {
              logToFile(
                `[pi] ✗ ${event.toolName}: ${String(event.result).slice(
                  0,
                  300,
                )}`,
              );
            }
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

        // pi ends the run when the model stops emitting tool calls — some
        // models stop mid-plan (observed: gpt-5 ended after planning, zero
        // edits). While the task list has open items, nudge it to continue.
        const openTasks = () =>
          Array.from(taskStore.values()).filter(
            (t) => t.status !== 'completed',
          );
        for (
          let nudges = 0;
          !security.state.criticalViolation &&
          (openTasks().length > 0 || editWriteCount === 0) &&
          nudges < 2;
          nudges++
        ) {
          const remaining = openTasks()
            .map((t) => t.content)
            .join('; ');
          const reason =
            editWriteCount === 0
              ? 'You have not modified any project files yet — the integration is not implemented.'
              : `Your task list still has incomplete items: ${remaining}.`;
          logToFile(`[pi] continuation nudge ${nudges + 1}: ${reason}`);
          await agentSession.prompt(
            `${reason} Continue the workflow now and complete it. Do not stop while work is outstanding unless it is genuinely impossible — in that case mark the task completed and state why.`,
          );
        }

        // The evaluator hard-caps on build sanity. If the project defines a
        // verification script and bash never ran, ask once.
        if (!security.state.criticalViolation && bashCount === 0) {
          try {
            const pkg = JSON.parse(
              fs.readFileSync(
                path.join(session.installDir, 'package.json'),
                'utf8',
              ),
            ) as { scripts?: Record<string, string> };
            const script = ['typecheck', 'type-check', 'build', 'lint'].find(
              (name) => pkg.scripts?.[name],
            );
            if (script) {
              logToFile(`[pi] verification nudge: '${script}' never ran`);
              await agentSession.prompt(
                `Before finishing: run the project's \`${script}\` script via bash and fix any failures it reports in the files you changed.`,
              );
            }
          } catch (err) {
            logToFile(`[pi] verification nudge skipped: ${String(err)}`);
          }
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

      const remark = signals.remark();
      if (remark) {
        analytics.capture(WIZARD_REMARK_EVENT_NAME, { remark });
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
};
