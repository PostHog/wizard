/**
 * The pi session machinery shared by the harness's two entry points: the
 * linear `run()` (index.ts) and the orchestrator's per-task `runTask()`
 * (task.ts). One copy of the gateway/registry wiring, the hermetic resource
 * loader, the coding-tool definitions, the session event handler, and the
 * error/usage bookkeeping — so the two runs configure the same machinery
 * instead of drifting apart (the 429 sniff and the analytics shape especially).
 *
 * No typebox in this module graph: index.ts imports it statically (the
 * CommonJS unit-test seam loads it), while the SDK itself always arrives as
 * the caller's lazy import, passed in as `sdk`.
 */

import { getUI, type SpinnerHandle } from '@ui';
import { logToFile } from '@utils/debug';
import { analytics } from '@utils/analytics';
import { WIZARD_USER_AGENT } from '@lib/constants';
import { AgentErrorType } from '@lib/agent/agent-interface';
import { AgentSignals } from '@lib/agent/signals';
import type { AgentOutputSignals } from '@lib/agent/output-signals';
import type { BootstrapResult } from '@lib/agent/runner/shared/types';
import type { ThinkingLevel } from '../../switchboard/models';
import { buildGatewayProvider, GATEWAY_PROVIDER } from './gateway';

/** The lazily imported pi SDK module, passed in by the caller. */
export type PiSdk = typeof import('@earendil-works/pi-coding-agent');
export type PiAgentSession = Awaited<
  ReturnType<PiSdk['createAgentSession']>
>['session'];
type PiModelRegistry = ReturnType<PiSdk['ModelRegistry']['inMemory']>;
type PiModel = NonNullable<ReturnType<PiModelRegistry['find']>>;

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

/**
 * Register the PostHog gateway on a fresh in-memory registry and resolve the
 * model. Undefined when the model can't be resolved — the caller returns its
 * API_ERROR. `applyEffortFlag`/`effort` follow `buildGatewayProvider`:
 * the linear run honours the wizard-pi-effort flag, a per-task run passes
 * `applyEffortFlag: false` and its own frontmatter effort.
 */
export function resolveGatewayModel(
  sdk: PiSdk,
  boot: BootstrapResult,
  modelId: string,
  opts: { applyEffortFlag?: boolean; effort?: ThinkingLevel } = {},
):
  | {
      registry: PiModelRegistry;
      model: PiModel;
      caps: ReturnType<typeof buildGatewayProvider>['caps'];
      gatewayUrl: string;
    }
  | undefined {
  const { provider, caps, gatewayUrl } = buildGatewayProvider({
    gatewayUrl: boot.credentials.host.gatewayUrl,
    accessToken: boot.credentials.accessToken,
    wizardMetadata: boot.wizardMetadata,
    wizardFlags: boot.wizardFlags,
    modelId,
    applyEffortFlag: opts.applyEffortFlag,
    effort: opts.effort,
  });
  const registry = sdk.ModelRegistry.inMemory(sdk.AuthStorage.create());
  registry.registerProvider(GATEWAY_PROVIDER, provider as never);
  const model = registry.find(GATEWAY_PROVIDER, modelId);
  if (!model) return undefined;
  return { registry, model, caps, gatewayUrl };
}

/**
 * Wire the real PostHog MCP, best-effort: if the adapter can't load or
 * connect, the run continues (minus the posthog_* tools) rather than failing.
 * The caller pushes `extensionFactory` after the security factory and calls
 * `cleanup` when the session ends.
 */
export async function connectPostHogMcp(
  sdk: PiSdk,
  boot: BootstrapResult,
  tag: string,
): Promise<{
  extensionFactory?: (pi: unknown) => void;
  cleanup?: () => void;
  instructions?: string;
}> {
  try {
    const { setupPostHogMcp } = await import('./mcp');
    return await setupPostHogMcp({
      agentDir: sdk.getAgentDir(),
      mcpUrl: boot.credentials.host.mcpUrl,
      accessToken: boot.credentials.accessToken,
      userAgent: WIZARD_USER_AGENT,
    });
  } catch (err) {
    logToFile(`${tag} PostHog MCP setup skipped: ${String(err)}`);
    return {};
  }
}

/**
 * The stock coding tools rooted at `dir`, each tagged with its execution mode
 * and bash wired to the scrubbed subprocess env. Factories, not instances, so
 * a caller registers exactly the tools its allow list grants.
 */
export function piCodingToolFactories(sdk: PiSdk, dir: string) {
  return {
    read: () => withMode(sdk.createReadToolDefinition(dir), 'parallel'),
    edit: () => withMode(sdk.createEditToolDefinition(dir), 'sequential'),
    write: () => withMode(sdk.createWriteToolDefinition(dir), 'sequential'),
    bash: () =>
      withMode(
        sdk.createBashToolDefinition(dir, {
          spawnHook: (ctx) => ({ ...ctx, env: buildScrubbedEnv() }),
        }),
        'sequential',
      ),
    ls: () => withMode(sdk.createLsToolDefinition(dir), 'parallel'),
    find: () => withMode(sdk.createFindToolDefinition(dir), 'parallel'),
    grep: () => withMode(sdk.createGrepToolDefinition(dir), 'parallel'),
  } as const;
}

/**
 * A hermetic pi session: the given system prompt and extensions only — no
 * disk-discovered extensions, skills, context files, prompt templates, or
 * themes from the target project — with pi's default built-in tools disabled
 * so `customTools` is the entire tool surface. Fires the extension lifecycle
 * (`bindExtensions`) before returning, which the MCP adapter connects on.
 */
export async function createHermeticSession(
  sdk: PiSdk,
  opts: {
    cwd: string;
    systemPrompt: string;
    extensionFactories: Array<(pi: unknown) => void>;
    model: PiModel;
    registry: PiModelRegistry;
    thinkingLevel?: ThinkingLevel;
    customTools: Parameters<PiSdk['createAgentSession']>[0]['customTools'];
  },
): Promise<PiAgentSession> {
  const resourceLoader = new sdk.DefaultResourceLoader({
    cwd: opts.cwd,
    agentDir: sdk.getAgentDir(),
    systemPrompt: opts.systemPrompt,
    noExtensions: true,
    noSkills: true,
    noContextFiles: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: opts.extensionFactories,
  });
  await resourceLoader.reload();

  const { session } = await sdk.createAgentSession({
    model: opts.model,
    modelRegistry: opts.registry,
    thinkingLevel: opts.thinkingLevel,
    cwd: opts.cwd,
    sessionManager: sdk.SessionManager.inMemory(opts.cwd),
    resourceLoader,
    noTools: 'builtin',
    customTools: opts.customTools,
  });
  await session.bindExtensions({});
  return session;
}

/** Counters the session watcher keeps live; read them after the run. */
export interface SessionCounts {
  assistantTurns: number;
  toolCalls: number;
}

/**
 * Map pi session events onto the run spinner + the log file, mirroring the
 * anthropic path's log shape (assistant turns + tool I/O) and driving the
 * single run spinner with one stable status at a time. `[STATUS]` lines
 * surface into the live spinner and status history; outro markers apply as
 * they stream; every assistant line feeds `signals`.
 */
export function watchSession(
  agentSession: PiAgentSession,
  opts: { tag: string; spinner: SpinnerHandle; signals: AgentOutputSignals },
): { counts: SessionCounts; unsubscribe: () => void } {
  const { tag, spinner, signals } = opts;
  const counts: SessionCounts = { assistantTurns: 0, toolCalls: 0 };
  const unsubscribe = agentSession.subscribe((event) => {
    switch (event.type) {
      case 'message_end': {
        // User prompts also emit message_end; only assistant turns count.
        if ((event.message as { role?: string })?.role !== 'assistant') {
          break;
        }
        counts.assistantTurns += 1;
        const assistant = extractText(event.message).trim();
        if (assistant) {
          logToFile(`${tag} assistant: ${assistant.slice(0, 1000)}`);
          applyOutroMarkers(assistant);
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
        counts.toolCalls += 1;
        const args = JSON.stringify(event.args ?? {}).slice(0, 200);
        logToFile(`${tag} → ${event.toolName} ${args}`);
        // Don't surface raw tool names in the spinner — the anthropic path
        // doesn't, and it reads as noise.
        break;
      }
      case 'tool_execution_end': {
        if (event.isError) {
          logToFile(
            `${tag} ✗ ${event.toolName}: ${String(event.result).slice(0, 300)}`,
          );
        }
        break;
      }
      case 'agent_end': {
        logToFile(`${tag} agent_end (willRetry=${String(event.willRetry)})`);
        break;
      }
      default:
        break;
    }
  });
  return { counts, unsubscribe };
}

/** A run clock: call once at start, call the result for the durations shape. */
export function startRunClock(): () => {
  duration_ms: number;
  duration_seconds: number;
} {
  const startTime = Date.now();
  return () => {
    const durationMs = Date.now() - startTime;
    return {
      duration_ms: durationMs,
      duration_seconds: Math.round(durationMs / 1000),
    };
  };
}

/** Classify a thrown run error the way both entry points report it. */
export function classifyRunError(err: unknown): {
  error: AgentErrorType;
  message: string;
} {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  const error =
    lower.includes('rate limit') || lower.includes('429')
      ? AgentErrorType.RATE_LIMIT
      : AgentErrorType.API_ERROR;
  return { error, message };
}

/**
 * The `agent completed` capture both entry points send, plus one parseable
 * usage line in the log so a run's per-unit time and cost are observable
 * without analytics access. `task=` appears only when the run carries a
 * task_type (orchestrator units); the linear run has none.
 */
export function captureAgentUsage(opts: {
  tag: string;
  modelId: string;
  counts: SessionCounts;
  durations: { duration_ms: number; duration_seconds: number };
  stats: ReturnType<PiAgentSession['getSessionStats']>;
  analyticsProperties?: Record<string, unknown>;
}): void {
  const { tag, modelId, counts, durations, stats, analyticsProperties } = opts;
  analytics.wizardCapture('agent completed', {
    ...durations,
    model: modelId,
    num_turns: counts.assistantTurns,
    // API-reported tokens only; no total_cost_usd — the API returns no
    // cost, and $ai_generation already prices the run authoritatively.
    input_tokens: stats.tokens.input,
    output_tokens: stats.tokens.output,
    cache_creation_input_tokens: stats.tokens.cacheWrite,
    cache_read_input_tokens: stats.tokens.cacheRead,
    ...analyticsProperties,
  });
  const taskType =
    typeof analyticsProperties?.task_type === 'string'
      ? analyticsProperties.task_type
      : undefined;
  logToFile(
    `${tag} usage${taskType ? ` task=${taskType}` : ''} model=${modelId} dur=${
      durations.duration_seconds
    }s turns=${counts.assistantTurns} in=${stats.tokens.input} out=${
      stats.tokens.output
    } cacheR=${stats.tokens.cacheRead} cacheW=${stats.tokens.cacheWrite}`,
  );
}
