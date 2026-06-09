/**
 * Experimental task-queue orchestrator runner.
 *
 * Branches from the linear runner when the `wizard-orchestrator` flag is on. An
 * orchestrator agent inspects the repo and seeds an in-memory task queue; an
 * executor drains it, running one fresh agent per task.
 *
 * This is the walking skeleton. The seed agent plans a task graph, and each task
 * is a dry-run stub that only reports a handoff, so the whole pipeline runs
 * end-to-end without touching the user's project. Real per-task work, served from
 * context-mill as `agents`, replaces the stub prompts later.
 */
import { randomUUID } from 'crypto';
import {
  initializeAgent,
  runAgent,
  type AgentConfig,
} from '../../agent/agent-interface';
import { OutroKind, type WizardSession } from '../../wizard-session';
import { detectNodePackageManagers } from '../../detection/package-manager';
import { getUI } from '../../../ui';
import { analytics } from '../../../utils/analytics';
import { logToFile } from '../../../utils/debug';
import type { ProgramConfig } from '../program-step';
import type { BootstrapResult } from '../../agent/agent-runner';
import type { WizardRunOptions } from '../../../utils/types';
import { QueueStore, type TaskStatus } from './queue';
import { drainQueue, type RunTask } from './executor';
import {
  SKELETON_TASK_TYPES,
  buildSeedPrompt,
  buildStubPrompt,
} from './skeleton-prompts';

/** The seed plans the graph, so it gets a stronger model; stub tasks are cheap. */
const SEED_MODEL = 'claude-sonnet-4-6';
const STUB_MODEL = 'claude-haiku-4-5-20251001';
/** The skeleton never edits the user's project. */
const NO_EDIT_TOOLS = ['Write', 'Edit', 'Bash'] as const;

function toTodoStatus(status: TaskStatus): string {
  switch (status) {
    case 'in_progress':
      return 'in_progress';
    case 'done':
    case 'failed':
      return 'completed';
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
  const store = new QueueStore(session.installDir, runId);

  const options = sessionRunOptions(session);

  logToFile(
    `[orchestrator] START program=${programConfig.id} dir=${session.installDir} run=${runId}`,
  );
  analytics.wizardCapture('orchestrator started', {
    program_id: programConfig.id,
  });
  getUI().startRun();

  const renderQueue = () =>
    getUI().syncTodos(
      store.list().map((t) => ({
        content: t.type,
        status: toTodoStatus(t.status),
        activeForm: `Running ${t.type}`,
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
      validTypes: SKELETON_TASK_TYPES,
      currentTaskId,
    },
  });

  const spinner = getUI().spinner();

  // 1. Seed the queue with the orchestrator agent.
  const seedAgent = await initializeAgent(agentConfigFor(), options);
  const seedResult = await runAgent(
    { ...seedAgent, model: SEED_MODEL, disallowedTools: [...NO_EDIT_TOOLS] },
    buildSeedPrompt(),
    options,
    spinner,
    {
      spinnerMessage: 'Planning the integration...',
      successMessage: 'Planned the integration',
      additionalFeatureQueue: [],
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

  // 2. Drain the queue, one fresh agent per task. Independent tasks run in
  // parallel — the graph the seed planned is the only schedule.
  const runTask: RunTask = async (task) => {
    renderQueue();
    const agent = await initializeAgent(agentConfigFor(task.id), options);
    try {
      await runAgent(
        {
          ...agent,
          model: task.model ?? STUB_MODEL,
          disallowedTools: [...NO_EDIT_TOOLS],
        },
        buildStubPrompt(task),
        options,
        spinner,
        {
          spinnerMessage: `Running ${task.type}...`,
          successMessage: `${task.type} done`,
          additionalFeatureQueue: [],
        },
      );
    } finally {
      renderQueue();
    }
  };
  await drainQueue(store, runTask);

  renderQueue();

  const summary = store.summary();
  logToFile(
    `[orchestrator] DONE done=${summary.done} failed=${summary.failed} total=${summary.total}`,
  );
  analytics.wizardCapture('orchestrator run finished', {
    tasks_total: summary.total,
    tasks_done: summary.done,
    tasks_failed: summary.failed,
  });

  const message = `Orchestrator dry run finished: ${summary.done}/${summary.total} tasks completed.`;
  getUI().setOutroData({
    kind: OutroKind.Success,
    message,
    reportFile: store.queuePath,
    docsUrl: 'https://posthog.com/docs/ai-engineering/ai-wizard',
  });
  getUI().outro(message);
  await analytics.shutdown('success');
}
