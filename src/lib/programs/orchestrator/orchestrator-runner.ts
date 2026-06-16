/**
 * Experimental task-queue orchestrator runner.
 *
 * Branches from the linear runner when the `wizard-orchestrator` flag is on. An
 * orchestrator agent inspects the repo and seeds an in-memory task queue; an
 * executor drains it, running one fresh agent per task.
 *
 * Both the WHAT (agent prompts: model, goal, success criteria, tools) and the
 * HOW (mini-skills) are markdown served from context-mill — the seed and every
 * task resolve to a prompt fetched at startup into the registry. The wizard side
 * stays product-ignorant: it is the queue, the executor, and the loader.
 */
import { randomUUID } from 'crypto';
import { existsSync, rmSync } from 'fs';
import * as path from 'path';
import {
  initializeAgent,
  runAgent,
  type AgentConfig,
} from '../../agent/agent-interface';
import { OutroKind, type WizardSession } from '../../wizard-session';
import { detectNodePackageManagers } from '../../detection/package-manager';
import { installSkillById } from '../../wizard-tools';
import { getUI } from '../../../ui';
import { analytics } from '../../../utils/analytics';
import { ciExcludedTaskTypes } from '../../../utils/ci-flag-overrides';
import { logToFile } from '../../../utils/debug';
import type { ProgramConfig } from '../program-step';
import type { BootstrapResult } from '../../agent/agent-runner';
import type { WizardRunOptions } from '../../../utils/types';
import {
  QueueStore,
  QUEUE_DIR_NAME,
  TaskStatus,
  type QueuedTask,
} from './queue';
import { drainQueue, type RunTask } from './executor';
import { RunMetrics } from './run-metrics';
import {
  agentRunTools,
  assembleSeedPrompt,
  assembleTaskPrompt,
  loadAgentRegistry,
  resolveTask,
  taskModel,
  type OrchestratorPromptContext,
} from '../../agent/agent-prompt-loader';

function toTodoStatus(status: TaskStatus): string {
  switch (status) {
    case TaskStatus.Running:
      return 'in_progress';
    case TaskStatus.Done:
    case TaskStatus.Failed:
      return 'completed';
    case TaskStatus.Skipped:
      return 'skipped';
    default:
      return 'pending';
  }
}

function sessionRunOptions(session: WizardSession): WizardRunOptions {
  return {
    installDir: session.installDir,
    debug: session.debug,
    default: false,
    signup: session.signup,
    localMcp: session.localMcp,
    ci: session.ci,
    benchmark: session.benchmark,
    projectId: session.projectId,
    apiKey: session.apiKey,
    yaraReport: session.yaraReport,
  };
}

export async function runOrchestrator(
  session: WizardSession,
  programConfig: ProgramConfig,
  boot: BootstrapResult,
): Promise<void> {
  const runId = randomUUID();

  const options = sessionRunOptions(session);

  // The WHAT (agent prompts) is served from context-mill. Fetch the registry
  // once up front: its types drive enqueue validation, and resolving a task to
  // its run config is then synchronous, with no mid-drain network latency.
  const registry = await loadAgentRegistry(
    boot.skillsBaseUrl,
    programConfig.id,
    { exclude: ciExcludedTaskTypes() },
  );
  const seedPrompt = registry.seed;
  if (!seedPrompt) {
    throw new Error(
      `No seed agent prompt (frontmatter \`seed: true\`) for flow "${programConfig.id}" is available from ${boot.skillsBaseUrl}.`,
    );
  }

  // Every wizard event from here on carries the variant, so orchestrator runs
  // segment cleanly from the linear baseline.
  analytics.setTag('variant', 'orchestrator');

  // Responsiveness is the headline metric of the dark launch: time to first
  // visible progress, and no single step dominating wall-clock. Track it from
  // queue transitions, with the resolved model so cheap work is attributable
  // to cheap models.
  const runStartMs = Date.now();
  const metrics = new RunMetrics(runStartMs);
  const durationMs = (t: QueuedTask) =>
    t.startedAt && t.finishedAt
      ? Date.parse(t.finishedAt) - Date.parse(t.startedAt)
      : undefined;

  const store = new QueueStore(session.installDir, runId, {
    onTransition: (event, task) => {
      const base = {
        type: task.type,
        model: taskModel(registry, task),
        attempts: task.attempts,
      };
      switch (event) {
        case 'enqueue':
          analytics.wizardCapture('orchestrator task enqueued', {
            type: task.type,
            enqueued_by: task.enqueuedBy,
            dynamic: task.enqueuedBy !== 'orchestrator',
          });
          break;
        case 'start':
          analytics.wizardCapture('orchestrator task started', {
            ...base,
            ...metrics.recordStart(Date.now()),
          });
          break;
        case 'complete':
          metrics.recordComplete(Date.now());
          analytics.wizardCapture('orchestrator task completed', {
            ...base,
            duration_ms: durationMs(task),
          });
          break;
        case 'skip':
          metrics.recordTerminal(Date.now());
          analytics.wizardCapture('orchestrator task skipped', {
            ...base,
            duration_ms: durationMs(task),
          });
          break;
        case 'fail':
          metrics.recordTerminal(Date.now());
          analytics.wizardCapture('orchestrator task failed', {
            ...base,
            duration_ms: durationMs(task),
            error: task.error?.type,
          });
          break;
        case 'requeue':
          break;
      }
    },
  });

  // Give task agents the framework's finished reference integration to match,
  // the same EXAMPLE.md the linear flow uses. Install it under the run dir rather
  // than .claude/skills so its "do everything" workflow is not auto-loaded as a
  // skill — only the example file is read, when the agent's prompt points at it.
  let examplePath: string | undefined;
  let commandmentsPath: string | undefined;
  if (session.skillId) {
    const ref = await installSkillById(
      session.skillId,
      session.installDir,
      boot.skillsBaseUrl,
      path.join(QUEUE_DIR_NAME, 'reference'),
    );
    if (ref.kind === 'ok') {
      const example = path.join(ref.path, 'references', 'EXAMPLE.md');
      if (existsSync(path.join(session.installDir, example))) {
        examplePath = example;
      }
      const commandments = path.join(ref.path, 'references', 'COMMANDMENTS.md');
      if (existsSync(path.join(session.installDir, commandments))) {
        commandmentsPath = commandments;
      }
    } else {
      logToFile(`[orchestrator] reference example unavailable: ${ref.kind}`);
    }
  }

  // The client injects the basics (project context + the I/O contract) around
  // every authored agent-prompt body.
  const promptContext: OrchestratorPromptContext = {
    projectId: boot.projectId,
    projectApiKey: boot.projectApiKey,
    host: boot.host,
    examplePath,
    commandmentsPath,
  };

  logToFile(
    `[orchestrator] START program=${programConfig.id} dir=${session.installDir} run=${runId}`,
  );
  analytics.wizardCapture('orchestrator started', {
    program_id: programConfig.id,
  });
  getUI().startRun();

  // Label precedence: what the orchestrator set at enqueue, then the agent
  // prompt's default, then the bare type.
  const labelFor = (t: { type: string; label?: string }) =>
    t.label ?? registry.get(t.type)?.label ?? t.type;
  const renderQueue = () =>
    getUI().syncTodos(
      store.list().map((t) => ({
        content: labelFor(t),
        status: toTodoStatus(t.status),
        activeForm: labelFor(t),
      })),
    );

  // Each agent gets its own config so its wizard-tools server is bound to the
  // task it runs — independent tasks run in parallel, and attribution of
  // complete_task / enqueue_task must hold per agent. The seed is not a task,
  // so its context has no task id.
  const agentConfigFor = (currentTaskId?: string): AgentConfig => ({
    workingDirectory: session.installDir,
    posthogMcpUrl: boot.mcpUrl,
    posthogApiKey: boot.accessToken,
    posthogApiHost: boot.host,
    detectPackageManager: detectNodePackageManagers,
    skillsBaseUrl: boot.skillsBaseUrl,
    wizardFlags: boot.wizardFlags,
    // Tag agent events as orchestrator so telemetry segments from the baseline.
    wizardMetadata: { ...boot.wizardMetadata, VARIANT: 'orchestrator' },
    integrationLabel: programConfig.id,
    orchestrator: {
      store,
      validTypes: registry.types,
      currentTaskId,
    },
  });

  const spinner = getUI().spinner();

  // 1. Seed the queue with the orchestrator agent. It is itself an agent prompt
  // (the WHAT), so its model and tools come from its frontmatter. The seed
  // plans the graph, it is not a task.
  const seedAgent = await initializeAgent(agentConfigFor(), options);
  const seedResult = await runAgent(
    {
      ...seedAgent,
      model: seedPrompt.model ?? seedAgent.model,
      ...agentRunTools(seedPrompt),
    },
    assembleSeedPrompt(promptContext, seedPrompt.body),
    options,
    spinner,
    {
      spinnerMessage: 'Planning the integration...',
      successMessage: 'Planned the integration',
      additionalFeatureQueue: [],
      requestRemark: false,
      analyticsProperties: { task_type: 'seed' },
    },
  );
  if (seedResult.error) {
    logToFile(
      `[orchestrator] seed error: ${seedResult.error} ${
        seedResult.message ?? ''
      }`,
    );
  }
  analytics.wizardCapture('orchestrator seeded', {
    task_count: store.list().length,
    types: store.list().map((t) => t.type),
  });
  renderQueue();

  // 2. Drain the queue, one fresh agent per task; independent tasks run in
  // parallel, the seed's graph being the only schedule. Each task resolves to
  // its agent prompt (the WHAT) and the mini-skills it needs (the HOW), then
  // runs on its own model and tools.
  const taskSkillsRoot = path.join(QUEUE_DIR_NAME, 'skills');
  let remarkRequested = false;
  const runTask: RunTask = async (task) => {
    renderQueue();
    try {
      const resolved = resolveTask(registry, task, store);
      const agent = await initializeAgent(agentConfigFor(task.id), options);
      // Task instructions are one-run scaffolding, not durable skills, so they
      // install under the run dir rather than .claude/skills — the SDK must not
      // auto-load them and they must never land in the project (or a CI PR).
      // The prompt points the agent at them instead.
      const skillPaths: string[] = [];
      for (const skillId of resolved.skills) {
        const result = await installSkillById(
          skillId,
          session.installDir,
          boot.skillsBaseUrl,
          taskSkillsRoot,
        );
        if (result.kind === 'ok') {
          skillPaths.push(path.join(result.path, 'SKILL.md'));
        } else {
          logToFile(
            `[orchestrator] skill install failed type=${task.type} skill=${skillId} ${result.kind}`,
          );
        }
      }
      // The run-end reflection fires once, on the task that is last in the
      // queue when it starts — nothing else pending or running alongside it.
      const isLastTask = !store
        .list()
        .some(
          (t) =>
            t.id !== task.id &&
            (t.status === TaskStatus.Pending ||
              t.status === TaskStatus.Running),
        );
      const requestRemark = isLastTask && !remarkRequested;
      if (requestRemark) remarkRequested = true;
      await runAgent(
        {
          ...agent,
          model: resolved.model,
          allowedTools: resolved.allowedTools,
          disallowedTools: resolved.disallowedTools,
        },
        assembleTaskPrompt(promptContext, resolved.prompt, skillPaths),
        options,
        spinner,
        // Empty messages suppress the per-task spinner lines (the spinner renders
        // only when a message is set); the queue panel shows progress. Errors
        // still surface — runAgent stops the spinner with its own error text.
        {
          spinnerMessage: '',
          successMessage: '',
          additionalFeatureQueue: [],
          requestRemark,
          analyticsProperties: { task_type: task.type, task_id: task.id },
        },
      );
    } finally {
      renderQueue();
    }
  };
  try {
    await drainQueue(store, runTask);
  } finally {
    // Success or failure, no run artifact outlives the run — wipe the whole
    // cache folder (queue, handoffs, reference example, installed task
    // instructions). The .DELETE-ME.md inside is the fallback if we don't.
    try {
      rmSync(path.join(session.installDir, QUEUE_DIR_NAME), {
        recursive: true,
        force: true,
      });
    } catch (err) {
      analytics.captureException(
        err instanceof Error ? err : new Error(String(err)),
        { step: 'orchestrator_cache_cleanup' },
      );
    }
  }

  renderQueue();

  const summary = store.summary();
  logToFile(
    `[orchestrator] DONE done=${summary.done} failed=${summary.failed} total=${summary.total}`,
  );
  analytics.wizardCapture('orchestrator run finished', {
    tasks_total: summary.total,
    tasks_done: summary.done,
    tasks_failed: summary.failed,
    tasks_skipped: summary.skipped,
    total_duration_ms: Date.now() - runStartMs,
    ...metrics.summary(),
    dynamic_enqueue_count: store
      .list()
      .filter((t) => t.enqueuedBy !== 'orchestrator').length,
    retried_task_count: store.list().filter((t) => t.attempts > 1).length,
  });

  // The build step flags any unresolved conflict in its handoff; surface the
  // one-liner here and point the user at the report for the detail.
  const buildTask = store.list().find((t) => t.type === 'build');
  const conflict = buildTask
    ? store.readHandoff(buildTask.id)?.conflict
    : undefined;

  // Prefer the report the run wrote; fall back to the raw queue if it is missing.
  const reportPath = path.join(session.installDir, 'posthog-setup-report.md');
  const reportFile = existsSync(reportPath)
    ? 'posthog-setup-report.md'
    : store.queuePath;

  const message = conflict
    ? 'PostHog set up, with one conflict to review.'
    : `PostHog set up: ${summary.done}/${summary.total} steps completed.`;
  getUI().setOutroData({
    kind: OutroKind.Success,
    message,
    body: conflict
      ? `⚠ Build conflict: ${conflict}\nFull details are in the report.`
      : undefined,
    reportFile,
    docsUrl: 'https://posthog.com/docs/ai-engineering/ai-wizard',
  });
  getUI().outro(message);
  await analytics.shutdown('success');
}
