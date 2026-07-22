/**
 * Orchestrator-mode execution on pi: one fresh pi session per unit of work —
 * the seed plan, or one drained task. The linear pipeline's concerns (skill
 * menu, todo panel, event-plan cleanup) stay in `index.ts`; this module builds
 * the leaner per-task session: gateway model, security fence, the task's
 * allowed coding tools, the wizard env tools, and the in-process orchestrator
 * queue tools.
 *
 * The task's `allowedTools` / `disallowedTools` arrive in the wizard's tool
 * vocabulary (`Read`, `Edit`, `Glob`, …, plus MCP-qualified orchestrator names
 * from `agentRunTools`). pi is where they become real: allowed names decide
 * which pi tool definitions get registered at all, and the disallow list is
 * ALSO handed to the security fence, so a name that never got registered stays
 * blocked even if the model hallucinates it.
 *
 * Loaded lazily from `index.ts` (typebox/ESM constraint, same as tools.ts).
 */

import { getUI } from '@ui';
import { logToFile } from '@utils/debug';
import { analytics } from '@utils/analytics';
import { WIZARD_REMARK_EVENT_NAME, WIZARD_USER_AGENT } from '@lib/constants';
import { AgentErrorType } from '@lib/agent/agent-interface';
import { REMARK_INSTRUCTION } from '@lib/agent/signals';
import { AgentOutputSignals } from '@lib/agent/output-signals';
import { TaskStatus } from '../../sequence/orchestrator/queue';
import type { OrchestratorToolsContext } from '../../sequence/orchestrator/queue-tools';
import type { AgentResult, TaskRunInputs } from '../types';
import { buildGatewayProvider, GATEWAY_PROVIDER } from './gateway';
import {
  applyOutroMarkers,
  buildScrubbedEnv,
  extractText,
  lastStatusLine,
  withMode,
} from './index';

/** wizard tool vocabulary → the pi tool definitions it unlocks. */
const CODING_TOOL_MAP: Record<string, readonly string[]> = {
  Read: ['read'],
  Edit: ['edit'],
  Write: ['write'],
  Bash: ['bash'],
  Glob: ['find', 'ls'],
  Grep: ['grep'],
};

/** `mcp__posthog-wizard__enqueue_task` → `enqueue_task`; native names pass through. */
function shortToolName(name: string): string {
  return name.replace(/^mcp__posthog-wizard__/, '');
}

/**
 * The pi coding tools a task may use. An empty allow list means "no
 * restriction" (mirrors the SDK), so every coding tool registers.
 */
export function allowedPiCodingTools(
  allowedTools: readonly string[] | undefined,
): Set<string> {
  const allowed = (allowedTools ?? []).map(shortToolName);
  const names = allowed.length
    ? allowed.flatMap((name) => CODING_TOOL_MAP[name] ?? [])
    : Object.values(CODING_TOOL_MAP).flat();
  return new Set(names);
}

/**
 * The orchestrator queue tools this agent gets. Everything not disallowed:
 * the seed's frontmatter disallows `complete_task` (it is not a task), a
 * task's disallows `enqueue_task` (the seed owns the graph).
 */
export function allowedOrchestratorTools(
  disallowedTools: readonly string[] | undefined,
): Set<string> {
  const disallowed = new Set((disallowedTools ?? []).map(shortToolName));
  return new Set(
    ['enqueue_task', 'complete_task', 'read_handoffs'].filter(
      (name) => !disallowed.has(name),
    ),
  );
}

/**
 * The disallow list for the security fence: the wizard-vocabulary names as
 * given (the fence translates pi built-ins to the same vocabulary) plus the
 * short names, so a disallowed orchestrator tool is blocked under the name pi
 * would call it by.
 */
export function fenceDisallowList(
  disallowedTools: readonly string[] | undefined,
): string[] {
  const names = disallowedTools ?? [];
  return [...new Set([...names, ...names.map(shortToolName)])];
}

/** Nudges when the session returns without the work reaching a terminal state. */
const MAX_TASK_NUDGES = 3;

const TASK_NUDGE =
  'You have not called complete_task yet. Finish your task now: if the work is done, call complete_task with your handoff; if it cannot be done, call it with status "failed" or "not needed" and say why.';

const SEED_NUDGE =
  'The queue is still empty. Seed it now with enqueue_task calls for the task graph you planned.';

/** Task-mode runtime notes — the harness constraints that survive into task mode. */
function taskRuntimeNotes(opts: {
  bash: boolean;
  posthogMcp: boolean;
}): string {
  const lines = [
    '## This runtime',
    'Below are important guidance on the harness constraints you are bound to. Follow them as commandments.',
    '- When you need several INDEPENDENT operations — reading or searching multiple files — issue them as multiple tool calls in a SINGLE turn. They run in parallel and save round-trips. Only sequence calls when one needs a previous call’s output.',
    '- Explore with the `ls`, `find`, and `grep` tools. `read` is for FILES only — reading a directory errors. NEVER inspect files through `bash`.',
    '- If a tool call is blocked, do NOT retry it or a reworded variant — the fence is deterministic. Change approach or note it in your handoff and move on.',
    '- A `[YARA]` block from the security scanner caught a real problem in the edit you just tried (PII in a `capture()`, a hardcoded secret or host URL). Read the block reason and change the CODE to comply — e.g. move PII off the event and onto the person via `identify()`/`$set`. Never write a PostHog URL or token as a literal in source; read them from environment variables.',
    "- To inspect or change a project's `.env` files use `check_env_keys` and `set_env_values` — a plain `read`, `edit`, or `write` of any `.env*` file is blocked.",
    '- Status updates are PLAIN TEXT you write in your reply, NOT a tool call. When you begin a new action, put a line starting with the literal marker [STATUS] and a short present-tense phrase in the SAME turn as a tool call. Never send a turn that is ONLY a [STATUS] line — a turn with no tool call ends the run.',
    '- When you are done, call `complete_task` exactly once with your structured handoff, in the same turn as your closing words. Do not stop before calling it.',
    '- Name events in snake_case (e.g. todo_created), never with spaces.',
  ];
  if (opts.bash) {
    lines.push(
      '- `bash` is ONLY for install/build/typecheck/lint/format commands the project itself defines. Run commands BARE and synchronously: no `cd`, no `&`, `&&`, or pipes, no output redirection. Its full output is returned to you.',
    );
  }
  if (opts.posthogMcp) {
    lines.push(
      '- The PostHog dashboard and insight tools are in your tool list directly, named `posthog_<tool>` (e.g. `posthog_dashboard-create`, `posthog_insight-create`). Use the ones present in your tool list; do not guess names.',
    );
  }
  return lines.join('\n');
}

/** Whether this unit of work has reached its terminal state. */
function isSettled(ctx: OrchestratorToolsContext): boolean {
  if (!ctx.currentTaskId) {
    // The seed's job is a seeded queue, not a complete_task call.
    return ctx.store.list().length > 0;
  }
  const task = ctx.store.get(ctx.currentTaskId);
  return (
    !!task &&
    (task.status === TaskStatus.Done ||
      task.status === TaskStatus.Failed ||
      task.status === TaskStatus.Skipped)
  );
}

export async function runPiTask(inputs: TaskRunInputs): Promise<AgentResult> {
  const {
    session,
    boot,
    prompt,
    spinner,
    model: modelId,
    effort,
    allowedTools,
    disallowedTools,
    orchestrator,
    spinnerMessage,
    successMessage,
    errorMessage,
    requestRemark,
    analyticsProperties,
  } = inputs;

  if (spinnerMessage) spinner.start(spinnerMessage);

  const startTime = Date.now();
  const signals = new AgentOutputSignals();
  let assistantTurns = 0;
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
      ...analyticsProperties,
    });

  try {
    const sdk = await import('@earendil-works/pi-coding-agent');
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
    } = sdk;

    const { provider, caps, gatewayUrl } = buildGatewayProvider({
      gatewayUrl: boot.credentials.host.gatewayUrl,
      accessToken: boot.credentials.accessToken,
      wizardMetadata: boot.wizardMetadata,
      wizardFlags: boot.wizardFlags,
      modelId,
      // Per-task agents own their effort via the prompt frontmatter, falling
      // back to the model table.
      effort,
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

    // The same fail-closed fence as the linear run, with the task's disallow
    // list layered in (both the wizard-vocabulary and pi-short names).
    const { createSecurityExtension } = await import('./security');
    const security = createSecurityExtension({
      disallowedTools: fenceDisallowList(disallowedTools),
      triageAuth: {
        baseURL: gatewayUrl,
        authToken: boot.credentials.accessToken,
      },
    });
    const { prewarmYaraScanner } = await import('@lib/yara-hooks');
    void prewarmYaraScanner();

    // PostHog MCP, best-effort — the dashboard task creates real dashboards
    // through it; every other task simply never calls a posthog_* tool.
    const extensionFactories = [security.factory] as Array<
      (pi: unknown) => void
    >;
    let mcpCleanup: (() => void) | undefined;
    let posthogMcp = false;
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
      posthogMcp = true;
    } catch (err) {
      logToFile(`[pi-task] PostHog MCP setup skipped: ${String(err)}`);
    }

    const codingTools = allowedPiCodingTools(allowedTools);
    const orchestratorTools = allowedOrchestratorTools(disallowedTools);

    const { getWizardCommandments } = await import('@lib/agent/commandments');
    const resourceLoader = new DefaultResourceLoader({
      cwd: session.installDir,
      agentDir: getAgentDir(),
      systemPrompt:
        getWizardCommandments() +
        '\n' +
        taskRuntimeNotes({ bash: codingTools.has('bash'), posthogMcp }),
      noExtensions: true,
      noSkills: true,
      noContextFiles: true,
      noPromptTemplates: true,
      noThemes: true,
      extensionFactories,
    });
    await resourceLoader.reload();

    // The task's coding tools, gated by its allow list. Reads and searches run
    // in parallel; mutating tools stay sequential. Bash subprocesses get the
    // scrubbed env, same as the linear run.
    const dir = session.installDir;
    const codingToolFactories = {
      read: () => withMode(createReadToolDefinition(dir), 'parallel'),
      edit: () => withMode(createEditToolDefinition(dir), 'sequential'),
      write: () => withMode(createWriteToolDefinition(dir), 'sequential'),
      bash: () =>
        withMode(
          createBashToolDefinition(dir, {
            spawnHook: (ctx) => ({ ...ctx, env: buildScrubbedEnv() }),
          }),
          'sequential',
        ),
      ls: () => withMode(createLsToolDefinition(dir), 'parallel'),
      find: () => withMode(createFindToolDefinition(dir), 'parallel'),
      grep: () => withMode(createGrepToolDefinition(dir), 'parallel'),
    } as const;
    const codingToolDefs = Object.entries(codingToolFactories)
      .filter(([name]) => codingTools.has(name))
      .map(([, make]) => make());

    // Wizard env + package-manager tools are always on — their handlers are
    // fenced, and init/build tasks depend on them.
    const { createWizardPiTools } = await import('./tools');
    const wizardTools = createWizardPiTools({
      workingDirectory: dir,
      skillsBaseUrl: boot.skillsBaseUrl,
    }).filter((t) =>
      ['check_env_keys', 'set_env_values', 'detect_package_manager'].includes(
        t.name,
      ),
    );

    const { createPiOrchestratorTools } = await import('./orchestrator-tools');
    const queueTools = createPiOrchestratorTools(orchestrator).filter((t) =>
      orchestratorTools.has(t.name),
    );

    const { session: agentSession } = await createAgentSession({
      model,
      modelRegistry: registry,
      thinkingLevel: caps.thinkingLevel,
      cwd: dir,
      sessionManager: SessionManager.inMemory(dir),
      resourceLoader,
      noTools: 'builtin',
      customTools: [...codingToolDefs, ...wizardTools, ...queueTools],
    });
    await agentSession.bindExtensions({});

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
            logToFile(`[pi-task] assistant: ${assistant.slice(0, 1000)}`);
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
          const args = JSON.stringify(event.args ?? {}).slice(0, 200);
          logToFile(`[pi-task] → ${event.toolName} ${args}`);
          break;
        }
        case 'tool_execution_end': {
          if (event.isError) {
            logToFile(
              `[pi-task] ✗ ${event.toolName}: ${String(event.result).slice(
                0,
                300,
              )}`,
            );
          }
          break;
        }
        default:
          break;
      }
    });

    try {
      await agentSession.prompt(prompt);

      // pi's prompt() resolves the moment a turn carries no tool call — which
      // an agent mid-plan does emit. While the work has not reached its
      // terminal state (task not reported, seed queue still empty), nudge.
      let nudges = 0;
      while (
        nudges < MAX_TASK_NUDGES &&
        !security.state.criticalViolation &&
        !isSettled(orchestrator)
      ) {
        nudges += 1;
        logToFile(
          `[pi-task] completion guard: not settled, nudge ${nudges}/${MAX_TASK_NUDGES}`,
        );
        await agentSession.prompt(
          orchestrator.currentTaskId ? TASK_NUDGE : SEED_NUDGE,
        );
      }

      if (requestRemark && !security.state.criticalViolation) {
        try {
          await agentSession.prompt(REMARK_INSTRUCTION);
        } catch (err) {
          logToFile(`[pi-task] remark request failed: ${String(err)}`);
        }
      }
    } finally {
      unsubscribe();
      mcpCleanup?.();
    }

    if (security.state.criticalViolation) {
      spinner.stop('Security violation detected');
      logToFile(
        `[pi-task] terminated: YARA violation (blocked ${security.state.blockedCount} call(s))`,
      );
      captureAborted();
      return { error: AgentErrorType.YARA_VIOLATION };
    }

    const remark = signals.remark();
    if (remark) {
      analytics.capture(WIZARD_REMARK_EVENT_NAME, { remark });
    }

    const stats = agentSession.getSessionStats();
    const durations = runDurations();
    analytics.wizardCapture('agent completed', {
      ...durations,
      model: modelId,
      num_turns: assistantTurns,
      input_tokens: stats.tokens.input,
      output_tokens: stats.tokens.output,
      cache_creation_input_tokens: stats.tokens.cacheWrite,
      cache_read_input_tokens: stats.tokens.cacheRead,
      ...analyticsProperties,
    });
    // Per-task usage on one parseable line so a run's per-task time and cost are
    // observable from the log, not only from analytics.
    const taskType =
      typeof (analyticsProperties as { task_type?: unknown })?.task_type ===
      'string'
        ? (analyticsProperties as { task_type: string }).task_type
        : modelId;
    logToFile(
      `[pi-task] usage task=${taskType} model=${modelId} dur=${durations.duration_seconds}s turns=${assistantTurns} in=${stats.tokens.input} out=${stats.tokens.output} cacheR=${stats.tokens.cacheRead} cacheW=${stats.tokens.cacheWrite}`,
    );
    if (successMessage) spinner.stop(successMessage);
    return {};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logToFile(`[pi-task] run error: ${message}`);
    if (errorMessage || spinnerMessage) {
      spinner.stop(errorMessage ?? 'Task failed');
    }
    captureAborted();
    const lower = message.toLowerCase();
    if (lower.includes('rate limit') || lower.includes('429')) {
      return { error: AgentErrorType.RATE_LIMIT, message };
    }
    return { error: AgentErrorType.API_ERROR, message };
  }
}
