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

import { logToFile } from '@utils/debug';
import { analytics } from '@utils/analytics';
import {
  Harness,
  Sequence,
  WIZARD_REMARK_EVENT_NAME,
  WIZARD_USER_AGENT,
} from '@shared/constants';
import {
  allowsPostHogMcp,
  queueTools,
  renderToolInventory,
} from '@agent/agent-prompt-loader';
import { AgentErrorType } from '@agent/agent-interface';
import { REMARK_INSTRUCTION } from '@agent/signals';
import { AgentOutputSignals } from '@agent/output-signals';
import { TaskStatus } from '../../sequence/orchestrator/queue';
import type { OrchestratorToolsContext } from '../../sequence/orchestrator/queue-tools';
import type { AgentResult, TaskRunInputs } from '../types';
import { gatewayAuth, type GatewayAuth } from '@agent/gateway-session';
import { currentAccessToken } from '@shared/oauth-session';
import {
  buildGatewayProvider,
  GATEWAY_PROVIDER,
  withGatewayRemint,
} from './gateway';
import { runErrorType } from './completion';
import { bindPiCancellation } from './cancellation';
import { classifyRunFailure, ErrorCodes } from '@shared/errors';
import { assembleCommandments } from '../../switchboard/commandments';
import {
  applyOutroMarkers,
  buildScrubbedEnv,
  extractText,
  lastStatusLine,
  withMode,
} from './index';
import { createAioCapture } from '@agent/aio-capture';

/** wizard tool vocabulary → the pi tool definitions it unlocks. */
const CODING_TOOL_MAP: Record<string, readonly string[]> = {
  Read: ['read'],
  Edit: ['edit'],
  Write: ['write'],
  Bash: ['bash'],
  Glob: ['find', 'ls'],
  Grep: ['grep'],
};

/** `mcp__wizard-tools__wizard_ask` → `wizard_ask`; native names pass through. */
function shortToolName(name: string): string {
  return name.replace(/^mcp__.+?__/, '');
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
  return new Set(queueTools(disallowedTools ?? []));
}

/**
 * The wizard tools a task gets. Four are always on — their handlers are fenced
 * and the coding tasks depend on them. The rest are opt-in per task through
 * its frontmatter: `wizard_ask` stops the run until a person answers, and the
 * skill-menu pair (`load_skill_menu`, `install_skill`) lets a task pull its
 * own skill variant.
 */
const ALWAYS_ON_WIZARD_TOOLS = [
  'check_env_keys',
  'set_env_values',
  'detect_package_manager',
  'publish_handoff',
];

const OPT_IN_WIZARD_TOOLS = [
  'wizard_ask',
  'load_skill_menu',
  'install_skill',
  // Audit programs only: they declare the ledger tools on `allowedTools`.
  'audit_seed_checks',
  'audit_add_checks',
  'audit_resolve_checks',
];

export function allowedPiWizardTools(
  allowedTools: readonly string[] | undefined,
): Set<string> {
  const allowed = (allowedTools ?? []).map(shortToolName);
  return new Set([
    ...ALWAYS_ON_WIZARD_TOOLS,
    ...OPT_IN_WIZARD_TOOLS.filter((tool) => allowed.includes(tool)),
  ]);
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
  if (inputs.signal?.aborted) {
    return {
      kind: 'abort',
      classification: AgentErrorType.ABORT,
      message: 'Agent run cancelled',
    };
  }
  const {
    config,
    input,
    boot,
    emit,
    prompt,
    spinner,
    model: modelId,
    effort,
    allowedTools,
    disallowedTools,
    askBridge,
    orchestrator,
    spinnerMessage,
    successMessage,
    errorMessage,
    requestRemark,
    analyticsProperties,
  } = inputs;

  if (spinnerMessage) spinner.start(spinnerMessage);

  const capture = createAioCapture({
    enabled: input.flags.captureAio,
    projectApiKey: boot.credentials.projectApiKey,
    apiHost: boot.credentials.host.apiHost,
    runTags: boot.wizardMetadata,
  });

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
  // How this task run failed: the closed AgentErrorType it is about to return.
  // Without it every terminal path below — a security termination, a rate
  // limit, a gateway error — arrived as the same unlabelled event, so a task
  // agent that died could be counted but not diagnosed. A security stop is not
  // an error, hence "failure mode" over "error".
  //
  // Not `reason`: the linear sequence emits this same event with a `reason`
  // holding the agent's free-text [ABORT] string, and one property cannot be
  // both a closed enum and unbounded prose without making either unreadable.
  const captureAborted = (failureMode: AgentErrorType) =>
    analytics.wizardCapture('agent aborted', {
      failure_mode: failureMode,
      ...runDurations(),
      model: modelId,
      ...analyticsProperties,
    });

  let mcpCleanup: (() => void) | undefined;
  let aioFailed = true;
  let cancellation: ReturnType<typeof bindPiCancellation> | undefined;
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

    // Reads the live OAuth token, so a mid-run rotation re-mints on the new one.
    const refreshAuth = async () =>
      gatewayAuth(
        boot.credentials.host,
        await currentAccessToken(boot.credentials),
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
      // Per-task agents own their effort via the prompt frontmatter, falling
      // back to the model table.
      effort,
    });
    const { provider, caps } = buildGatewayProvider(providerInputs(auth));
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

    // Shared flag: true while a wizard_ask overlay is open. The ask tool sets
    // it (onAskPendingChange, below); the security fence reads it to pause
    // Write/Edit until the answer comes back. Wired the same way as the linear
    // pi run — without it the warehouse task could mutate files while its
    // credential prompt sits open (up to LONGER_ASK_TIMEOUT_MS).
    const askState = { pending: false };

    // The same fail-closed fence as the linear run, with the task's disallow
    // list layered in (both the wizard-vocabulary and pi-short names).
    const { createSecurityExtension } = await import('./security');
    const security = createSecurityExtension({
      disallowedTools: fenceDisallowList(disallowedTools),
      triageProvider: boot.triageProvider,
      getWizardAskPending: () => askState.pending,
    });
    const { prewarmYaraScanner } = await import('@agent/yara-hooks');
    void prewarmYaraScanner();

    // PostHog MCP, for the tasks whose prompt requests it. Tasks that never
    // asked skip the handshake and never see a posthog tool.
    const extensionFactories = [security.factory] as Array<
      (pi: unknown) => void
    >;
    let posthogMcp = false;
    if (allowsPostHogMcp(allowedTools)) {
      try {
        const { setupPostHogMcp } = await import('./mcp');
        const mcp = await setupPostHogMcp({
          mcpUrl: boot.credentials.host.mcpUrl,
          accessToken: await currentAccessToken(boot.credentials),
          userAgent: WIZARD_USER_AGENT,
        });
        extensionFactories.push(mcp.extensionFactory);
        mcpCleanup = mcp.cleanup;
        posthogMcp = true;
      } catch (err) {
        try {
          mcpCleanup?.();
        } catch {
          /* Setup cleanup is best effort. */
        }
        mcpCleanup = undefined;
        // Silent here reads as a task failure minutes later: a task that asked
        // for this tool can only skip or fail without it.
        logToFile(`[pi-task] PostHog MCP setup skipped: ${String(err)}`);
        analytics.wizardCapture('mcp setup failed', {
          harness: 'pi',
          scope: 'task',
          error: String(err).slice(0, 300),
        });
      }
    }

    const codingTools = allowedPiCodingTools(allowedTools);
    const orchestratorTools = allowedOrchestratorTools(disallowedTools);

    const resourceLoader = new DefaultResourceLoader({
      cwd: input.installDir,
      agentDir: getAgentDir(),
      systemPrompt: assembleCommandments({
        program: config.programId,
        sequence: Sequence.orchestrator,
        harness: Harness.pi,
        caps: { bash: codingTools.has('bash'), posthogMcp },
      }),
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
    const dir = input.installDir;
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
    // fenced, and init/build tasks depend on them. publish_handoff rides
    // along (it only emits) so the report task can publish the handoff.
    const { createWizardPiTools } = await import('./tools');
    const wizardToolNames = allowedPiWizardTools(allowedTools);
    const wizardTools = createWizardPiTools({
      workingDirectory: dir,
      skillsBaseUrl: boot.skillsBaseUrl,
      triageProvider: boot.triageProvider,
      emit,
      // Present only for a task allowed to ask; without it wizard_ask errors
      // instead of hanging on a prompt nobody will ever see.
      askBridge,
      // Pause Write/Edit while the ask overlay is open (see askState above).
      onAskPendingChange: (pending) => {
        askState.pending = pending;
      },
    }).filter((t) => wizardToolNames.has(t.name));

    const { createPiOrchestratorTools } = await import('./orchestrator-tools');
    const queueTools = createPiOrchestratorTools(orchestrator).filter((t) =>
      orchestratorTools.has(t.name),
    );

    const customTools = [...codingToolDefs, ...wizardTools, ...queueTools];
    const { session: agentSession } = await createAgentSession({
      model,
      modelRegistry: registry,
      thinkingLevel: caps.thinkingLevel,
      cwd: dir,
      sessionManager: SessionManager.inMemory(dir),
      resourceLoader,
      noTools: 'builtin',
      customTools,
    });
    cancellation = bindPiCancellation(inputs.signal, agentSession, (error) => {
      logToFile(`[pi-task] abort failed: ${String(error)}`);
    });
    await agentSession.bindExtensions({});

    // A turn that ends on a 401 from an aged bearer re-mints once and
    // continues with the nudge the task would get anyway.
    const turns = withGatewayRemint({
      signal: inputs.signal,
      session: agentSession,
      registry,
      auth,
      refreshAuth,
      providerInputs,
      continueText: () =>
        orchestrator.currentTaskId ? TASK_NUDGE : SEED_NUDGE,
      onRemint: () => {
        logToFile('[pi-task] gateway token renewed after a 401; continuing');
        analytics.wizardCapture('gateway token reminted', { harness: 'pi' });
      },
    });

    // The one complete list: exactly the tools registered on this session, in
    // the names the agent will call them by. posthog_exec binds as an extension.
    const toolNames = [
      ...customTools.map((t) => t.name),
      ...(posthogMcp ? ['posthog_exec'] : []),
    ];
    logToFile(`[pi-task] tools passed to model: ${toolNames.join(', ')}`);
    const taskPrompt = `${prompt}\n\n${renderToolInventory(toolNames)}`;

    const unsubscribe = agentSession.subscribe((event) => {
      // Mirror the turn into AIO. No-op when --capture-aio is off. Runs
      // before the role guard so the module's own filter is authoritative.
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
          if (assistant) {
            logToFile(`[pi-task] assistant: ${assistant.slice(0, 1000)}`);
            applyOutroMarkers(assistant, emit);
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
          const args = JSON.stringify(event.args ?? {}).slice(0, 200);
          logToFile(`[pi-task] → ${event.toolName} ${args}`);
          break;
        }
        case 'tool_execution_end': {
          if (event.isError) {
            const detail =
              typeof event.result === 'string'
                ? event.result
                : JSON.stringify(event.result ?? '');
            logToFile(`[pi-task] ✗ ${event.toolName}: ${detail.slice(0, 300)}`);
          }
          break;
        }
        default:
          break;
      }
    });

    // Seed AIO capture with this task's prompt — includes any handoff data
    // from prior tasks (the orchestrator bakes it into the prompt string
    // before it reaches this call site).
    capture.setInitialPrompt(taskPrompt);

    let terminal = turns.terminalFailure();
    try {
      if (inputs.signal?.aborted)
        return {
          kind: 'abort',
          classification: AgentErrorType.ABORT,
          message: 'Agent run cancelled',
        };
      await turns.prompt(taskPrompt);
      terminal = turns.terminalFailure();

      // pi's prompt() resolves the moment a turn carries no tool call — which
      // an agent mid-plan does emit. While the work has not reached its
      // terminal state (task not reported, seed queue still empty), nudge.
      let nudges = 0;
      while (
        nudges < MAX_TASK_NUDGES &&
        !security.state.criticalViolation &&
        !inputs.signal?.aborted &&
        !terminal &&
        !isSettled(orchestrator)
      ) {
        nudges += 1;
        logToFile(
          `[pi-task] completion guard: not settled, nudge ${nudges}/${MAX_TASK_NUDGES}`,
        );
        await turns.prompt(
          orchestrator.currentTaskId ? TASK_NUDGE : SEED_NUDGE,
        );
        terminal = turns.terminalFailure();
      }

      if (
        requestRemark &&
        !security.state.criticalViolation &&
        !terminal &&
        !inputs.signal?.aborted
      ) {
        try {
          await agentSession.prompt(REMARK_INSTRUCTION);
        } catch (err) {
          logToFile(`[pi-task] remark request failed: ${String(err)}`);
        }
      }
    } finally {
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

    if (terminal && !security.state.criticalViolation) {
      if (errorMessage || spinnerMessage)
        spinner.stop(errorMessage ?? 'Task failed');
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

    if (security.state.criticalViolation) {
      spinner.stop('Security violation detected');
      logToFile(
        `[pi-task] terminated: YARA violation (blocked ${security.state.blockedCount} call(s))`,
      );
      captureAborted(AgentErrorType.YARA_VIOLATION);
      return { kind: 'failure', classification: AgentErrorType.YARA_VIOLATION };
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
      `[pi-task] usage task=${taskType} model=${modelId} effort=${caps.thinkingLevel} dur=${durations.duration_seconds}s turns=${assistantTurns} in=${stats.tokens.input} out=${stats.tokens.output} cacheR=${stats.tokens.cacheRead} cacheW=${stats.tokens.cacheWrite}`,
    );
    if (successMessage) spinner.stop(successMessage);
    aioFailed = false;
    return { kind: 'success' };
  } catch (err) {
    if (inputs.signal?.aborted) {
      return {
        kind: 'abort',
        classification: AgentErrorType.ABORT,
        message: 'Agent run cancelled',
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    logToFile(`[pi-task] run error: ${message}`);
    if (errorMessage || spinnerMessage) {
      spinner.stop(errorMessage ?? 'Task failed');
    }
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
}
