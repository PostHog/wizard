/**
 * The `pi` backend — the challenger. Drives pi.dev's coding agent
 * (`@earendil-works/pi-coding-agent`) against the PostHog LLM gateway, behind
 * `wizard-runner=pi`. It owns the agent loop and model transport; prompt
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
import { getUI } from '../../../../ui';
import { getLogFilePath, logToFile } from '../../../../utils/debug';
import { getLlmGatewayUrlFromHost } from '../../../../utils/urls';
import {
  POSTHOG_FLAG_HEADER_PREFIX,
  POSTHOG_PROPERTY_HEADER_PREFIX,
  WIZARD_USER_AGENT,
} from '../../../constants';
import { AgentErrorType } from '../../agent-interface';
import { AgentSignals } from '../../signals';
import { getWizardCommandments } from '../../commandments';
import type { AgentBackend, AgentResult, BackendRunInputs } from './types';

/** Provider + model registered on the in-memory registry for this run. */
const GATEWAY_PROVIDER = 'posthog-gateway';
/** Bare model id (no `anthropic/` prefix) so the gateway's Bedrock fallback matches. */
const MODEL_ID = 'claude-sonnet-4-6';

/**
 * pi-specific runtime guidance appended to the shared commandments. Targets the
 * top run-slowness causes (profiled): the agent reaching for blocked `bash
 * ls/find` to explore (each retry is a model round-trip), re-fetching the skill
 * menu, and writing literal PostHog URLs that the YARA scanner blocks at write
 * time. Steering it once up front avoids the retry spirals.
 */
const PI_RUNTIME_NOTES = [
  '',
  '## This runtime',
  '- Explore with the `ls`, `find`, and `grep` tools (list a directory, find files by name, search file contents). `read` is for FILES only — reading a directory errors. NEVER run ls/find/cat/grep through `bash`; they are blocked and waste a turn.',
  '- `bash` is ONLY for install/build/typecheck/lint/format. Run installs synchronously and wait (e.g. `npm install <pkg>`); `&`, `&&`, and pipes are all blocked.',
  '- Call `load_skill_menu` once to choose the skill, then `install_skill`. Do not call `load_skill_menu` again this session.',
  "- Never write a PostHog URL or token as a literal in source (e.g. 'https://us.i.posthog.com') — it is blocked. Read them from environment variables (process.env.POSTHOG_HOST, os.environ['POSTHOG_HOST'], etc.).",
  '- The PostHog dashboard and insight tools are in your tool list directly, named `posthog_<tool>` (e.g. `posthog_dashboard-create`, `posthog_insight-create`). Use them for the dashboard step — call them like any other tool. Do not guess names; use the ones present in your tool list.',
  '- Update the task list FREQUENTLY as you work — mark items `completed` the moment you finish them and `in_progress` as you pick them up, so the displayed step always reflects where you actually are. Keep titles broad and action-oriented (the area of work), not specific files or sub-steps.',
  '- When the skill asks you to verify or revise, actually verify: run the project build/typecheck (via bash) and confirm the SDK imports and initializes. A file being written is not verification — that it compiles and imports is.',
  "- When you call `dispatch_agent`, make the prompt fully self-contained (exact paths, patterns, and the precise question) — the subagent can't see your context, is read-only, and can't dispatch further.",
].join('\n');

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

export const piBackend: AgentBackend = {
  name: 'pi',

  async run(inputs: BackendRunInputs): Promise<AgentResult> {
    const { session, boot, prompt, spinner, config, programConfig } = inputs;

    // Init banner (parity #5).
    getUI().log.step('Initializing Wizard agent...');
    getUI().log.step(`Verbose logs: ${getLogFilePath()}`);
    getUI().log.success("Agent initialized. Let's get cooking!");

    spinner.start(config.spinnerMessage ?? 'Customizing your PostHog setup...');

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

      // Register the PostHog gateway as an anthropic-messages provider. Auth is
      // the posthog token as a bearer; headers carry Bedrock-fallback + wizard
      // metadata/flags — identical to the claude-agent-sdk path.
      const baseUrl = getLlmGatewayUrlFromHost(boot.host);
      const registry = ModelRegistry.inMemory(AuthStorage.create());
      registry.registerProvider(GATEWAY_PROVIDER, {
        name: 'PostHog Gateway',
        baseUrl,
        apiKey: boot.accessToken,
        authHeader: true,
        api: 'anthropic-messages',
        headers: buildGatewayHeaders(boot.wizardMetadata, boot.wizardFlags),
        models: [
          {
            id: MODEL_ID,
            name: 'Claude Sonnet 4.6 (PostHog Gateway)',
            api: 'anthropic-messages',
            reasoning: true,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 200_000,
            maxTokens: 64_000,
          },
        ],
      });

      const model = registry.find(GATEWAY_PROVIDER, MODEL_ID);
      if (!model) {
        return {
          error: AgentErrorType.API_ERROR,
          message: 'pi: gateway model could not be resolved',
        };
      }
      logToFile(`[pi] gateway ${baseUrl} model ${MODEL_ID}`);

      // System prompt = wizard commandments. Skip project context files /
      // user extensions / skills so the run is hermetic; skills discovery is a
      // follow-up (#524).
      //
      // Fail-closed security (#525): an extension intercepts EVERY tool call —
      // built-in and custom — and reuses the anthropic policy (canUseTool
      // allowlist + .env fencing + YARA). `noExtensions: true` only suppresses
      // disk-discovered extensions; explicit `extensionFactories` still load,
      // so the fence is on while the target project can't inject its own.
      const { createSecurityExtension } = await import('./pi-security');
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
        const { setupPostHogMcp } = await import('./pi-mcp');
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
        systemPrompt: getWizardCommandments() + '\n' + PI_RUNTIME_NOTES,
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
      const { createWizardPiTools } = await import('./pi-tools');
      const { createWizardPiTaskTools } = await import('./pi-tasks');
      const { createDispatchAgentTool } = await import('./pi-subagent');
      // The one bash the agent (and its subagents) may use: every subprocess it
      // spawns gets a scrubbed env, so no secret or ambient variable reaches an
      // `npm install`. Shared with the subagent so the lockdown is inherited.
      const scrubbedBash = createBashToolDefinition(session.installDir, {
        spawnHook: (ctx) => ({ ...ctx, env: buildScrubbedEnv() }),
      });

      const customTools = [
        // Built-ins re-registered explicitly. `noTools: 'builtin'` disables pi's
        // defaults so we can supply the env-scrubbed bash above; read/edit/write
        // are the stock definitions, unchanged.
        createReadToolDefinition(session.installDir),
        createEditToolDefinition(session.installDir),
        createWriteToolDefinition(session.installDir),
        scrubbedBash,
        // Native ls/find/grep so the agent explores with proper tools instead
        // of fence-blocked `bash {ls/find}` (the profiled retry-spirals came
        // from this gap).
        createLsToolDefinition(session.installDir),
        createFindToolDefinition(session.installDir),
        createGrepToolDefinition(session.installDir),
        ...createWizardPiTools({
          workingDirectory: session.installDir,
          skillsBaseUrl: boot.skillsBaseUrl,
        }),
        // Task/todo tools (#526): render the todo list live in the TUI, parity
        // with the anthropic path.
        ...createWizardPiTaskTools().tools,
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
            const assistant = extractText(event.message).trim();
            if (assistant) {
              logToFile(`[pi] assistant: ${assistant.slice(0, 1000)}`);
              applyOutroMarkers(assistant);
            }
            break;
          }
          case 'tool_execution_start': {
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
        return { error: AgentErrorType.YARA_VIOLATION };
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

      spinner.stop(config.successMessage ?? 'PostHog integration complete');
      return {};
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logToFile(`[pi] run error: ${message}`);
      spinner.stop(config.errorMessage ?? `${config.integrationLabel} failed`);
      getUI().log.error(`pi backend error: ${message}`);

      const lower = message.toLowerCase();
      if (lower.includes('rate limit') || lower.includes('429')) {
        return { error: AgentErrorType.RATE_LIMIT, message };
      }
      return { error: AgentErrorType.API_ERROR, message };
    }
  },
};
