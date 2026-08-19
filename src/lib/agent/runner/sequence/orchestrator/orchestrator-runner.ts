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
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import * as path from 'path';
import {
  OutroKind,
  type TaskNotice,
  type WizardSession,
} from '@lib/wizard-session';
import {
  POSTHOG_DOCS_URL,
  WIZARD_CONTACT_EMAIL,
  type Integration,
} from '@lib/constants';
import { FRAMEWORK_REGISTRY } from '@lib/registry';
import {
  installSkillById,
  fetchSkillMenu,
  type SkillEntry,
} from '@lib/wizard-tools';
import { getUI } from '@ui';
import { analytics } from '@utils/analytics';
import { ciExcludedTaskTypes } from '@utils/ci-flag-overrides';
import { logToFile } from '@utils/debug';
import { wizardAbort, WizardError } from '@utils/wizard-abort';
import type { ProgramConfig } from '@lib/programs/program-step';
import type { BootstrapResult, ProgramRun } from '../../shared/types';
import {
  areSeededTasksEnabled,
  getHarness,
  resolveHarness,
  resolveStageOverrides,
  type HarnessPick,
} from '../../switchboard';
import { isValidModel, requireKnownModel } from '../../switchboard/models';
import type { AgentHarness } from '../../harness/types';
import {
  QueueStore,
  QUEUE_DIR_NAME,
  TaskStatus,
  type QueuedTask,
} from './queue';
import { drainQueue, type RunTask } from './executor';
import { RunMetrics } from './run-metrics';
import { dependencyClosure, uncoveredBySink } from './queue-tools';
import { deferSeededTasks } from './seeded-deps';
import { createWizardAskBridge } from '@lib/wizard-ask-bridge';
import { shouldDisableAsk } from '../../shared/bootstrap';
import {
  agentRunTools,
  assembleSeedPrompt,
  assembleTaskPrompt,
  loadAgentRegistry,
  promptModelFor,
  resolveTask,
  taskModelSpec,
  ASK_TOOL,
  type AgentPrompt,
  type OrchestratorPromptContext,
} from '@lib/agent/agent-prompt-loader';

/** Docs page (`django.md`, `nuxt-js-3-6.md`) — steps start with a digit, agent artifacts (`SKILL.md`, `EXAMPLE*`, `COMMANDMENTS.md`) have uppercase. */
const isDocPage = (name: string): boolean =>
  name.endsWith('.md') && name === name.toLowerCase() && !/^\d/.test(name);

/** Copy only the framework docs pages out of the run cache into .claude/skills — the one durable artifact an orchestrator run leaves. Never clobbers an existing install. */
export function promoteReferenceSkill(
  referenceDir: string,
  claudeSkillsDir: string,
  referenceSkillId: string,
): void {
  const target = path.join(claudeSkillsDir, referenceSkillId);
  const refs = path.join(referenceDir, 'references');
  if (!existsSync(refs) || existsSync(target)) return;
  const docs = readdirSync(refs).filter(isDocPage);
  if (docs.length === 0) return;
  mkdirSync(path.join(target, 'references'), { recursive: true });
  for (const f of docs) {
    cpSync(path.join(refs, f), path.join(target, 'references', f));
  }
  writeFileSync(path.join(target, '.posthog-wizard'), '');
}

/**
 * Remove skills that task agents installed durably mid-run (load_skill):
 * wizard-marked, new this run, and not the framework reference docs.
 * User-authored and pre-existing skills stay.
 */
export function sweepRunInstalledSkills(
  claudeSkillsDir: string,
  preexistingSkills: ReadonlySet<string>,
  referenceSkillId: string | undefined,
): void {
  if (!existsSync(claudeSkillsDir)) return;
  for (const id of readdirSync(claudeSkillsDir)) {
    if (preexistingSkills.has(id) || id === referenceSkillId) continue;
    if (!existsSync(path.join(claudeSkillsDir, id, '.posthog-wizard'))) {
      continue;
    }
    rmSync(path.join(claudeSkillsDir, id), { recursive: true, force: true });
    logToFile(`[orchestrator] removed run-installed skill ${id}`);
  }
}

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

/**
 * Look up the harness impl for a resolved pick and enforce the `runTask`
 * capability. Pi trips this today with the honest impl-gap error instead of
 * silently downgrading to anthropic.
 */
function requireTaskHarness(pick: HarnessPick): AgentHarness & {
  runTask: NonNullable<AgentHarness['runTask']>;
} {
  const harness = getHarness(pick.harness);
  if (!harness.runTask) {
    throw new Error(
      `Harness "${pick.harness}" does not implement runTask; orchestrator mode requires it.`,
    );
  }
  return harness as AgentHarness & {
    runTask: NonNullable<AgentHarness['runTask']>;
  };
}

/** Every skill entry the menu knows, across categories. */
async function fetchSkillMenuEntries(
  skillsBaseUrl: string,
): Promise<SkillEntry[]> {
  const menu = await fetchSkillMenu(skillsBaseUrl);
  if (!menu) return [];
  return Object.values(menu.categories).flat();
}

/** Menu id for a bare skill id + framework via the menu's declared group/framework/default fields; undefined when nothing matches. */
export function resolveSkillVariantId(
  entries: readonly SkillEntry[],
  skillId: string,
  framework: string | undefined,
): string | undefined {
  if (entries.some((e) => e.id === skillId)) return skillId;
  if (!framework) return undefined;
  const family = entries.filter(
    (e) => e.group === skillId && e.framework === framework,
  );
  return (family.find((e) => e.default) ?? family[0])?.id;
}

/**
 * The framework reference is the full `integration` skill. `session.skillId` is
 * the bare framework (e.g. `django`), but the skill menu ids it as
 * `integration-<variant>`.
 */
function resolveReferenceSkillId(
  entries: readonly SkillEntry[],
  framework: string,
): string | undefined {
  return resolveSkillVariantId(entries, 'integration', framework);
}

/**
 * A task that asks the user waits on a person, not on a model: long enough to
 * open a database console or mint a restricted API key. The drain waits it out
 * — the executor holds the task's promise — so the only real limit is this one.
 */
const TASK_ASK_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * How long an optional step's notice waits for an answer.
 *
 * Much shorter than the ask timeout above, because it is asking for something
 * much smaller: one keypress to accept or decline, not "go mint a restricted
 * Stripe key". The notice is also the only interactive screen sitting in front
 * of the run's final steps, so an unanswered one holds the report — and with it
 * the notebook and the outro — behind a modal nobody is looking at.
 */
export const TASK_NOTICE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Offer an optional step, defaulting to declining it if nobody answers.
 *
 * Skip is the right default on a timeout: continuing would send the step on to
 * ask for credentials that the same absent user cannot supply either, burning
 * {@link TASK_ASK_TIMEOUT_MS} per question before falling back to the same
 * links declining gives immediately.
 */
export async function offerSeededTask(
  notice: TaskNotice,
  timeoutMs: number = TASK_NOTICE_TIMEOUT_MS,
): Promise<{ keep: boolean; timedOut: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      // Dismisses the overlay and settles the showTaskNotice promise too, so
      // the losing side of the race cannot leave a modal on screen.
      getUI().cancelTaskNotice();
      resolve(false);
    }, timeoutMs);
  });
  try {
    const keep = await Promise.race([getUI().showTaskNotice(notice), timeout]);
    return { keep, timedOut };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Whether a task's prompt lets it ask the user, and so needs the ask bridge. */
function canAsk(prompt: AgentPrompt | undefined): boolean {
  return (prompt?.allowedTools ?? []).includes(ASK_TOOL);
}

/** Splits terminal failures into run-failing (required) and reported-only (optional). */
export function drainVerdict(tasks: readonly QueuedTask[]): {
  requiredFailedTypes: string[];
  optionalFailedTypes: string[];
  blocked: number;
} {
  const failed = tasks.filter((t) => t.status === TaskStatus.Failed);
  return {
    requiredFailedTypes: failed
      .filter((t) => t.optional !== true)
      .map((t) => t.type),
    optionalFailedTypes: failed
      .filter((t) => t.optional === true)
      .map((t) => t.type),
    blocked: tasks.filter((t) => t.status === TaskStatus.Pending).length,
  };
}

/** How many tasks deep in the graph a task sits — 0 when it depends on nothing. */
function graphDepth(
  task: QueuedTask,
  byId: ReadonlyMap<string, QueuedTask>,
  memo: Map<string, number>,
): number {
  const cached = memo.get(task.id);
  if (cached !== undefined) return cached;
  memo.set(task.id, 0); // breaks a cycle rather than recursing forever
  const depth = task.dependsOn.reduce((deepest, id) => {
    const dep = byId.get(id);
    return dep ? Math.max(deepest, graphDepth(dep, byId, memo) + 1) : deepest;
  }, 0);
  memo.set(task.id, depth);
  return depth;
}

/**
 * The queue in the order the user should read it, which is not the order tasks
 * were queued. Tasks the wizard seeded before the planner ran are queued first
 * but are optional side quests, so they sit at the end of the tier they run in
 * — the list reads as the run unfolds, and the first line is work that actually
 * started. Ordering only; nothing here changes what runs when.
 */
export function displayOrder(
  tasks: readonly QueuedTask[],
  isOptional: (task: QueuedTask) => boolean,
): QueuedTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const memo = new Map<string, number>();
  const rank = tasks.map((task, index) => ({
    task,
    depth: graphDepth(task, byId, memo),
    optional: isOptional(task) ? 1 : 0,
    index,
  }));
  return rank
    .sort(
      (a, b) =>
        a.depth - b.depth || a.optional - b.optional || a.index - b.index,
    )
    .map((entry) => entry.task);
}

export async function runOrchestrator(
  session: WizardSession,
  config: ProgramRun,
  programConfig: ProgramConfig,
  boot: BootstrapResult,
): Promise<void> {
  const runId = randomUUID();

  // Switchboard context — reused for every per-role harness resolution below.
  const switchboardCtx = {
    program: programConfig.id,
    flags: boot.wizardFlags,
    flagPayloads: boot.wizardFlagPayloads,
    cliHarness: session.harness,
    cliSequence: session.sequence,
    cliModel: session.model,
  };

  // The WHAT (agent prompts) is served from context-mill. Fetch the registry
  // once up front: its types drive enqueue validation, and resolving a task to
  // its run config is then synchronous, with no mid-drain network latency.
  const flow = programConfig.agentFlow ?? programConfig.id;
  const registry = await loadAgentRegistry(boot.skillsBaseUrl, flow, {
    exclude: ciExcludedTaskTypes(),
    // Baked into the prompts at load, so enqueue, dispatch, and telemetry all read one effective spec.
    overrides: resolveStageOverrides(
      programConfig.id,
      boot.wizardFlags,
      boot.wizardFlagPayloads,
    ),
  });
  const seedPrompt = registry.seed;
  if (!seedPrompt) {
    throw new Error(
      `No seed agent prompt (frontmatter \`seed: true\`) for flow "${flow}" is available from ${boot.skillsBaseUrl}.`,
    );
  }

  // The end decision the switchboard event defers to: the model each task will actually run on.
  const taskModels = Object.fromEntries(
    ['seed', ...registry.types].map((type) => {
      const prompt = type === 'seed' ? seedPrompt : registry.get(type);
      const pick = resolveHarness(switchboardCtx, type);
      const specModel = prompt && promptModelFor(prompt, pick.harness).model;
      return [type, isValidModel(specModel) ? specModel : pick.model];
    }),
  );
  logToFile(
    `[orchestrator] task models: ${Object.entries(taskModels)
      .map(([t, m]) => `${t}=${m}`)
      .join(' ')}`,
  );
  analytics.wizardCapture('orchestrator task models', taskModels);

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
      const pick = resolveHarness(switchboardCtx, task.type);
      // Mirror dispatch's allow-list fallback so attribution names the model that runs.
      const specModel = taskModelSpec(registry, task, pick.harness).model;
      const base = {
        type: task.type,
        model: isValidModel(specModel) ? specModel : pick.model,
        attempts: task.attempts,
        // A failed optional task aborts nothing (see drainVerdict).
        optional: task.optional === true,
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
  let referenceInstallPath: string | undefined;
  const menuSkillEntries = await fetchSkillMenuEntries(boot.skillsBaseUrl);
  const referenceSkillId = session.skillId
    ? resolveReferenceSkillId(menuSkillEntries, session.skillId)
    : undefined;
  if (referenceSkillId) {
    const ref = await installSkillById(
      referenceSkillId,
      session.installDir,
      boot.skillsBaseUrl,
      {
        skillsRoot: path.join(QUEUE_DIR_NAME, 'reference'),
        triage: boot.triageProvider,
      },
    );
    if (ref.kind === 'ok') {
      referenceInstallPath = ref.path;
      const example = path.join(ref.path, 'references', 'EXAMPLE.md');
      if (existsSync(path.join(session.installDir, example))) {
        examplePath = example;
      }
      const commandments = path.join(ref.path, 'references', 'COMMANDMENTS.md');
      if (existsSync(path.join(session.installDir, commandments))) {
        commandmentsPath = commandments;
      }
    } else {
      logToFile(
        `[orchestrator] reference unavailable: ${ref.kind} (${referenceSkillId})`,
      );
    }
  } else if (session.skillId) {
    logToFile(
      `[orchestrator] no integration skill for framework "${session.skillId}"`,
    );
  }

  // Preflight every task's mini-skills: a miss would run tasks skill-less, so fail properly instead.
  const missingVariants: string[] = [];
  for (const type of registry.types) {
    for (const skillId of registry.get(type)?.skills ?? []) {
      if (resolveSkillVariantId(menuSkillEntries, skillId, session.skillId)) {
        continue;
      }
      missingVariants.push(`${type}/${skillId}`);
      logToFile(
        `[orchestrator] no skill variant type=${type} skill=${skillId} framework=${
          session.skillId ?? 'none'
        }`,
      );
      analytics.wizardCapture('orchestrator skill variant missing', {
        task_type: type,
        skill: skillId,
        framework: session.skillId,
      });
    }
  }
  if (missingVariants.length > 0) {
    // The framework's own docs page from its config; generic docs when detection found none.
    const docsUrl = session.skillId
      ? FRAMEWORK_REGISTRY[session.skillId as Integration]?.docsUrl
      : undefined;
    await wizardAbort({
      message:
        'Setup instructions for this project failed to download.\n' +
        'Please try again, or contact wizard@posthog.com.\n\n' +
        'You can also set up with your agent by downloading the skills here:\n' +
        '  https://github.com/PostHog/context-mill/releases\n' +
        'or integrate manually here:\n' +
        `  ${docsUrl ?? POSTHOG_DOCS_URL}`,
      error: new WizardError('Orchestrator preflight: skill variant missing', {
        missing: missingVariants.join(', '),
        framework: session.skillId,
      }),
    });
  }

  // The client injects the basics (project context + the I/O contract) around
  // every authored agent-prompt body.
  const promptContext: OrchestratorPromptContext = {
    projectId: boot.credentials.projectId,
    projectApiKey: boot.credentials.projectApiKey,
    host: boot.credentials.host,
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
      displayOrder(store.list(), (t) =>
        registry.runnerSeededTypes.includes(t.type),
      ).map((t) => ({
        content: labelFor(t),
        status: toTodoStatus(t.status),
        activeForm: labelFor(t),
      })),
    );

  // Each task's run binds the wizard-tools MCP server to a per-task
  // orchestrator context so complete_task / enqueue_task attribute correctly
  // when independent tasks run in parallel. The seed is not a task, so its
  // context has no task id.
  const orchestratorCtx = (currentTaskId?: string) => ({
    store,
    // The planner is offered only the types an agent may queue. A runner-seeded
    // type is not among them, so an attempt to queue one trips the unknown-type
    // guard instead of duplicating work the wizard already placed.
    validTypes: registry.enqueueableTypes,
    sinkTypes: registry.sinkTypes,
    // The edge to a runner-seeded task is one-way: the sink may wait for it,
    // nothing else may. Enforced at enqueue, because prose alone cannot hold it
    // — a single planner edge is enough to pull the task back to the front of
    // the drain and put its prompt in front of the code work again.
    runnerSeededTypes: registry.runnerSeededTypes,
    currentTaskId,
  });

  // Tasks the wizard queues itself, from what detection found. They exist
  // before the planner runs, so the sink guard forces the reporting task to
  // depend on them, and no prompt has to remember they are there.
  // Kill switch: off (or unset), the wizard queues nothing itself and the run
  // is byte-identical to a project with no detected sources.
  const seedEntries = areSeededTasksEnabled(boot.wizardFlags)
    ? programConfig.seedTasks?.(session) ?? []
    : [];
  const seededTypes: string[] = [];
  // Kept so their dependencies can be resolved once the planner has run — they
  // are queued before it, so they cannot name what they wait for yet.
  const seededTasks: QueuedTask[] = [];
  // A seeded task's notice, held until the moment the task is about to run.
  // Asked here at seed time it would be the first thing in the run — a modal
  // before anything has happened, about work that will not start for minutes.
  // The queue stays product-ignorant, so the copy waits here rather than on the
  // task.
  const seededNotices = new Map<
    string,
    NonNullable<(typeof seedEntries)[number]['notice']>
  >();
  for (const seeded of seedEntries) {
    if (!registry.runnerSeededTypes.includes(seeded.type)) {
      logToFile(
        `[orchestrator] skipping runner-seeded task "${seeded.type}": not a runner-seeded type in this flow`,
      );
      continue;
    }
    const task = store.enqueue({
      type: seeded.type,
      label: seeded.label,
      inputs: seeded.inputs,
      enqueuedBy: 'orchestrator',
      // Terminal failure is reported per-task and never aborts the run.
      optional: true,
    });
    seededTypes.push(seeded.type);
    seededTasks.push(task);
    if (seeded.notice) seededNotices.set(task.id, seeded.notice);
    logToFile(`[orchestrator] runner-seeded task ${seeded.type}`);
  }

  // A run that stops to ask a person is not comparable with one that does not
  // — its wall-clock is the user's, not the model's. Tag every event of the run
  // from here on, so those runs filter out cleanly.
  const askingTypes = seededTypes.filter((type) => canAsk(registry.get(type)));
  analytics.setTag('orchestrator_awaits_user', askingTypes.length > 0);
  analytics.setTag(
    'orchestrator_runner_seeded_types',
    seededTypes.join(',') || 'none',
  );
  if (askingTypes.length > 0) {
    analytics.wizardCapture('orchestrator awaits user', {
      task_types: askingTypes,
      ask_timeout_ms: TASK_ASK_TIMEOUT_MS,
    });
  }

  // One bridge for the run, handed only to a task whose prompt allows asking.
  // Absent in CI and signup, where nobody can answer.
  const askBridge = shouldDisableAsk(session)
    ? undefined
    : createWizardAskBridge({
        getSource: () => session.skillId ?? programConfig.id,
        showQuestion: (q) => {
          // How late the first ask lands is the measure of this run shape: it
          // should follow the autonomous work, not interrupt it.
          metrics.recordAsk(Date.now());
          return getUI().requestQuestion(q);
        },
        cancelQuestion: () => getUI().cancelPendingQuestion(),
        richLinks: config.richLinks ?? false,
        timeoutMs: TASK_ASK_TIMEOUT_MS,
      });

  const spinner = getUI().spinner();

  // 1. Seed the queue with the orchestrator agent. It is itself an agent prompt
  // (the WHAT), so its model and tools come from its frontmatter. The seed
  // plans the graph, it is not a task.
  //
  // Prompt-frontmatter model wins over the switchboard pick (§3.6 of the
  // switchboard plan) — the switchboard's model is the fallback when the
  // prompt is silent.
  const seedPick = resolveHarness(switchboardCtx, 'seed');
  const seedHarness = requireTaskHarness(seedPick);
  const seedModel = promptModelFor(seedPrompt, seedPick.harness);
  const seedResult = await seedHarness.runTask({
    session,
    programConfig,
    boot,
    prompt: assembleSeedPrompt(promptContext, seedPrompt.body, store.list()),
    spinner,
    model: requireKnownModel(seedModel.model, seedPick.model),
    effort: seedModel.effort,
    ...agentRunTools(seedPrompt),
    orchestrator: orchestratorCtx(),
    spinnerMessage: 'Planning the integration...',
    successMessage: 'Planned the integration',
    additionalFeatureQueue: [],
    analyticsProperties: { task_type: 'seed', harness: seedPick.harness },
  });
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

  // Now that the graph exists, give each runner-seeded task the dependencies it
  // could not name when it was queued. Without this it sits at depth 0 and runs
  // in the first tier — which for the warehouse step means its credential
  // prompts arrive while the coding tasks are still writing files. Deferred, the
  // one step that waits on a person waits until the autonomous work is done.
  //
  // Before the sink check below on purpose: sinks are never added as
  // dependencies, so a planner that forgot to make its sink wait for a seeded
  // task is still caught there rather than masked here.
  const deferred = deferSeededTasks(
    store,
    seededTasks,
    (type) => registry.get(type)?.dependsOn ?? [],
    registry.sinkTypes,
  );
  for (const entry of deferred) {
    logToFile(
      `[orchestrator] deferred runner-seeded ${entry.type}: ` +
        `${entry.added.length} deps (${
          entry.declared
            ? `declared: ${entry.declaredTypes.join(', ')}`
            : 'default'
        })${
          entry.refused.length > 0 ? `, ${entry.refused.length} refused` : ''
        }${
          entry.unresolvedTypes.length > 0
            ? `, unresolved: ${entry.unresolvedTypes.join(', ')}`
            : ''
        }`,
    );
    analytics.wizardCapture('orchestrator seeded task deferred', {
      type: entry.type,
      dep_count: entry.added.length,
      declared: entry.declared,
      declared_types: entry.declaredTypes,
      unresolved_types: entry.unresolvedTypes,
      // Non-empty means a cycle or an unknown id was rejected — the resolver and
      // the queue disagreeing, never expected in a good run.
      refused_count: entry.refused.length,
    });
  }
  if (deferred.length > 0) renderQueue();

  // Canary for the one-way rule. The enqueue guard rejects the edge outright, so
  // this should never fire — but if it ever does, the seeded task has been
  // pulled back toward the front of the drain and its prompt lands mid-run
  // again, which is precisely the failure this whole step exists to prevent.
  // Silent regressions here would look like "the ordering just stopped
  // working", so make it visible rather than abort a run that is otherwise fine.
  for (const seeded of seededTasks) {
    const dependants = store
      .list()
      .filter(
        (t) =>
          !registry.sinkTypes.includes(t.type) &&
          t.id !== seeded.id &&
          dependencyClosure(store, [t.id]).has(seeded.id),
      );
    if (dependants.length === 0) continue;
    logToFile(
      `[orchestrator] one-way rule broken: ${dependants
        .map((t) => t.type)
        .join(', ')} depend on runner-seeded ${seeded.type}`,
    );
    analytics.wizardCapture('orchestrator seeded task depended on', {
      type: seeded.type,
      dependant_types: dependants.map((t) => t.type),
    });
  }

  // The enqueue guard rejects a sink that misses part of the queue, so a
  // planner that respected its errors cannot get here with a broken graph.
  // Check it again anyway: a run whose report never sees a task's handoff is
  // worse than a run that stops and says so.
  const unwaited = store
    .list()
    .filter((t) => registry.sinkTypes.includes(t.type))
    .flatMap((sink) =>
      uncoveredBySink(
        { store, validTypes: registry.types, sinkTypes: registry.sinkTypes },
        { type: sink.type, dependsOn: sink.dependsOn },
      ).filter((t) => t.id !== sink.id),
    );
  if (unwaited.length > 0) {
    analytics.wizardCapture('orchestrator sink invariant violated', {
      uncovered_types: unwaited.map((t) => t.type),
    });
    await wizardAbort({
      message: `The wizard could not plan this setup: the final step would have skipped ${unwaited
        .map((t) => t.type)
        .join(', ')}.\n\nPlease report this to: ${WIZARD_CONTACT_EMAIL}`,
      error: new WizardError('orchestrator sink does not cover the queue', {
        uncovered: unwaited.map((t) => `${t.type} (${t.id})`).join(', '),
        queue_state: JSON.stringify(store.list()),
      }),
    });
  }

  // 2. Drain the queue, one fresh agent per task; independent tasks run in
  // parallel, the seed's graph being the only schedule. Each task resolves to
  // its agent prompt (the WHAT) and the mini-skills it needs (the HOW), then
  // runs on its own model and tools.
  const taskSkillsRoot = path.join(QUEUE_DIR_NAME, 'skills');
  // Task agents can install durable skills mid-run (load_skill), and only the
  // framework reference docs earn a place — snapshot what was already there so
  // the sweeps remove exactly what this run added.
  const claudeSkillsDir = path.join(session.installDir, '.claude', 'skills');
  const preexistingSkills = new Set(
    existsSync(claudeSkillsDir) ? readdirSync(claudeSkillsDir) : [],
  );
  // One notice on screen at a time. The store keeps a single pending-notice
  // slot, so a second `showTaskNotice` overwrites the first's resolver: the
  // first promise never settles, its task hangs forever, and the overlay stack
  // is left one deep. Seeding used to await its notices in a loop, which made
  // that impossible; offering them from inside the drain does not, because the
  // executor starts every runnable task at once. Today's graphs still serialize
  // seeded tasks — the default deferral makes each wait for the one before —
  // but that is a property of the current graph, not a guarantee, so gate it
  // here where it cannot be undone by a future prompt declaring its own deps.
  let noticeGate: Promise<unknown> = Promise.resolve();
  const runTask: RunTask = async (task) => {
    renderQueue();

    // A task that stops for the user is offered, not imposed — and the offer
    // belongs here, the moment before it runs, not at the top of the run. By now
    // everything this task waits for is done, so the notice, the questions, and
    // the work form one block at the end instead of a modal that interrupts
    // before anything has happened.
    //
    // Declining skips the task rather than removing it: the planner has already
    // wired the sink to depend on it, and `nextRunnable` treats a skipped
    // dependency as satisfied, so the report still runs.
    const notice = seededNotices.get(task.id);
    if (notice) {
      // Consume the offer so it is shown at most once per run. A requeue keeps
      // the same task id, so without this delete a first attempt that fails or
      // ends without reporting would re-offer the notice on retry — re-entering
      // the very timeout stall this screen exists to prevent, double-firing the
      // notice analytics, and (on a retry decline) overwriting attempt 1's real
      // outcome with a skip. Later attempts fall through to the executor's
      // normal retry flow instead.
      seededNotices.delete(task.id);
      // Queue behind any notice already on screen. The catch keeps one
      // offer's failure from poisoning the gate for the next.
      const offer = noticeGate.then(() => offerSeededTask(notice));
      noticeGate = offer.catch(() => undefined);
      // Fail closed. The offer is consumed above, so letting a thrown error
      // escape would hand the task to the executor's retry path with no notice
      // left to show — and the second attempt would run the step, and start
      // asking for credentials, without anyone ever having agreed to it. No UI
      // implementation throws here today; this is about which way it breaks if
      // one ever does.
      const { keep, timedOut } = await offer.catch((err: unknown) => {
        logToFile(
          `[orchestrator] notice failed for ${task.type}, declining: ${String(
            err,
          )}`,
        );
        analytics.captureException(
          err instanceof Error ? err : new Error(String(err)),
          { step: 'orchestrator_task_notice' },
        );
        return { keep: false, timedOut: false };
      });
      analytics.wizardCapture('orchestrator task notice answered', {
        type: task.type,
        kept: keep,
        timed_out: timedOut,
      });
      if (!keep) {
        logToFile(
          `[orchestrator] runner-seeded ${task.type} declined (${
            timedOut ? 'timed out' : 'by the user'
          })`,
        );
        store.skip(task.id, {
          goals: notice.title,
          did: timedOut
            ? 'Nothing — the step was offered and the offer timed out with no answer.'
            : 'Nothing — the user chose to skip this step when offered it.',
          forNextAgent: timedOut
            ? 'This step was offered and nobody answered, so it did no work. Report it as not set up, and point the user at how to do it later.'
            : 'This step was offered and declined, so it did no work. Report it as skipped at the user’s request, not as failed.',
        });
        renderQueue();
        return;
      }
    }

    try {
      const resolved = resolveTask(registry, task, store);
      // Task instructions are one-run scaffolding, not durable skills, so they
      // install under the run dir rather than .claude/skills — the SDK must not
      // auto-load them and they must never land in the project (or a CI PR).
      // The prompt points the agent at them instead.
      const skillPaths: string[] = [];
      for (const skillId of resolved.skills) {
        // Agent prompts name the bare step-skill (`integration-v2-install`);
        // SDK-divergent steps ship per-framework variants, so resolve against
        // the menu with the session's framework before installing.
        const variantId = resolveSkillVariantId(
          menuSkillEntries,
          skillId,
          session.skillId,
        );
        if (!variantId) {
          logToFile(
            `[orchestrator] no skill variant type=${
              task.type
            } skill=${skillId} framework=${session.skillId ?? 'none'}`,
          );
          continue;
        }
        const result = await installSkillById(
          variantId,
          session.installDir,
          boot.skillsBaseUrl,
          { skillsRoot: taskSkillsRoot, triage: boot.triageProvider },
        );
        if (result.kind === 'ok') {
          skillPaths.push(path.join(result.path, 'SKILL.md'));
        } else {
          logToFile(
            `[orchestrator] skill install failed type=${task.type} skill=${variantId} ${result.kind}`,
          );
          // A task without its instructions must fail here, not run blind:
          // run 91cf40eb's report task started after two EACCES install
          // failures (unwritable external-volume cache) and died silently.
          // The executor catches this, captures the exception, and fails the
          // task through the normal outcome check.
          throw new Error(
            `Skill "${variantId}" for task "${task.type}" could not be installed (${result.kind}). ` +
              'If this is a permissions error, check that the project directory is writable.',
          );
        }
      }
      // Empty spinner messages suppress the per-task spinner line (the queue
      // panel shows progress); errors still surface — the harness stops the
      // spinner with its own error text.
      //
      // Per-task role = task.type — the switchboard consults
      // PROGRAM_BINDINGS[id].contextMillOverride?.[task.type] for wizard-side
      // per-agent overrides. Prompt-frontmatter model still wins (§3.6).
      const taskPick = resolveHarness(switchboardCtx, task.type);
      const taskHarness = requireTaskHarness(taskPick);
      const taskModel = taskModelSpec(registry, task, taskPick.harness);
      await taskHarness.runTask({
        session,
        programConfig,
        boot,
        prompt: assembleTaskPrompt(promptContext, resolved.prompt, skillPaths),
        spinner,
        model: requireKnownModel(taskModel.model, taskPick.model),
        effort: taskModel.effort,
        allowedTools: resolved.allowedTools,
        disallowedTools: resolved.disallowedTools,
        askBridge: canAsk(registry.get(task.type)) ? askBridge : undefined,
        orchestrator: orchestratorCtx(task.id),
        spinnerMessage: '',
        successMessage: '',
        additionalFeatureQueue: [],
        analyticsProperties: {
          task_type: task.type,
          task_id: task.id,
          harness: taskPick.harness,
        },
      });
    } finally {
      // Durable skills a task installed are irrelevant to later tasks — and
      // the sdk harness auto-loads .claude/skills into every agent — so sweep
      // as each task ends, not only at run end.
      try {
        sweepRunInstalledSkills(
          claudeSkillsDir,
          preexistingSkills,
          referenceSkillId,
        );
      } catch (err) {
        logToFile(`[orchestrator] per-task skill sweep failed: ${String(err)}`);
      }
      renderQueue();
    }
  };
  try {
    await drainQueue(store, runTask);
  } finally {
    try {
      if (referenceSkillId && referenceInstallPath) {
        promoteReferenceSkill(
          path.join(session.installDir, referenceInstallPath),
          claudeSkillsDir,
          referenceSkillId,
        );
      }
    } catch (err) {
      analytics.captureException(
        err instanceof Error ? err : new Error(String(err)),
        { step: 'orchestrator_reference_promote' },
      );
    }
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
    try {
      sweepRunInstalledSkills(
        claudeSkillsDir,
        preexistingSkills,
        referenceSkillId,
      );
    } catch (err) {
      analytics.captureException(
        err instanceof Error ? err : new Error(String(err)),
        { step: 'orchestrator_skill_sweep' },
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
    tasks_skipped: summary[TaskStatus.Skipped],
    total_duration_ms: Date.now() - runStartMs,
    ...metrics.summary(),
    dynamic_enqueue_count: store
      .list()
      .filter((t) => t.enqueuedBy !== 'orchestrator').length,
    retried_task_count: store.list().filter((t) => t.attempts > 1).length,
  });

  // The review step flags any unresolved conflict in its handoff; surface the
  // one-liner here and point the user at the report for the detail.
  const reviewTask = store.list().find((t) => t.type === 'review');
  const conflict = reviewTask
    ? store.readHandoff(reviewTask.id)?.conflict
    : undefined;

  // Not-needed tasks were never work, so they leave the denominator too.
  const notRequired = summary[TaskStatus.Skipped];

  // A drain that ends with failed tasks (retries exhausted) or tasks still
  // pending (blocked behind a failed dependency) did NOT set PostHog up —
  // abort like a linear agent failure instead of claiming success.
  // A failed optional task is exempt: reported per-task, never run-failing.
  const verdict = drainVerdict(store.list());
  const blocked = verdict.blocked;
  if (verdict.requiredFailedTypes.length > 0 || blocked > 0) {
    const failedTypes = verdict.requiredFailedTypes.join(', ');
    const whatFailed = failedTypes
      ? `the ${failedTypes} step failed`
      : `${blocked} steps never ran`;
    // A grant narrowed at login is the one failure cause the user can fix
    // alone — lead with the fix, and only fall back to the report-a-bug line
    // when trying again doesn't work.
    const missingScopes = boot.credentials.missingScopes ?? [];
    const message =
      missingScopes.length > 0
        ? `The wizard could not finish setup: ${whatFailed}, and this run was authorized without the following permission${
            missingScopes.length === 1 ? '' : 's'
          }: ${missingScopes.join(
            ', ',
          )}.\n\nPlease try again, approving all permissions on the PostHog authorization screen. If it still fails, report it to: ${WIZARD_CONTACT_EMAIL}`
        : `The wizard was unable to set up PostHog: ${whatFailed}.\n\nPlease report this to: ${WIZARD_CONTACT_EMAIL}`;
    await wizardAbort({
      message,
      error: new WizardError('orchestrator drain ended with failed tasks', {
        tasks_failed: summary.failed,
        tasks_blocked: blocked,
        failed_types: failedTypes,
        missing_oauth_scopes: missingScopes.join(' '),
        queue_state: JSON.stringify(store.list()),
      }),
    });
  }

  // A failed optional step leaves the denominator and is named instead.
  const optionalFailedCount = verdict.optionalFailedTypes.length;
  const stepNotes = [
    notRequired > 0 ? `${notRequired} skipped as not required` : '',
    optionalFailedCount > 0
      ? `${optionalFailedCount} optional step failed`
      : '',
  ].filter(Boolean);
  const message = conflict
    ? 'PostHog set up, with one conflict to review.'
    : `PostHog set up: ${summary.done}/${
        summary.total - notRequired - optionalFailedCount
      } steps completed${
        stepNotes.length > 0 ? ` (${stepNotes.join(', ')})` : ''
      }.`;
  getUI().setOutroData({
    kind: OutroKind.Success,
    message,
    body: conflict
      ? `⚠ Build conflict: ${conflict}\nFull details are in the setup report.`
      : undefined,
    docsUrl: 'https://posthog.com/docs/ai-engineering/ai-wizard',
  });
  getUI().outro(message);
  await analytics.shutdown('success');
}
