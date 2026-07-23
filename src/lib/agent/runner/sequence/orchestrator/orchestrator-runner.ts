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
import { OutroKind, type WizardSession } from '@lib/wizard-session';
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
import type { BootstrapResult } from '../../shared/types';
import {
  getHarness,
  resolveHarness,
  type HarnessPick,
} from '../../switchboard';
import type { AgentHarness } from '../../harness/types';
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
  promptModelFor,
  resolveTask,
  taskModelSpec,
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

export async function runOrchestrator(
  session: WizardSession,
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
  });
  const seedPrompt = registry.seed;
  if (!seedPrompt) {
    throw new Error(
      `No seed agent prompt (frontmatter \`seed: true\`) for flow "${flow}" is available from ${boot.skillsBaseUrl}.`,
    );
  }

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
      const base = {
        type: task.type,
        model: taskModelSpec(registry, task, pick.harness).model ?? pick.model,
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
      path.join(QUEUE_DIR_NAME, 'reference'),
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
      store.list().map((t) => ({
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
    validTypes: registry.types,
    currentTaskId,
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
    prompt: assembleSeedPrompt(promptContext, seedPrompt.body),
    spinner,
    model: seedModel.model ?? seedPick.model,
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
  const runTask: RunTask = async (task) => {
    renderQueue();
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
          taskSkillsRoot,
        );
        if (result.kind === 'ok') {
          skillPaths.push(path.join(result.path, 'SKILL.md'));
        } else {
          logToFile(
            `[orchestrator] skill install failed type=${task.type} skill=${variantId} ${result.kind}`,
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
        model: taskModel.model ?? taskPick.model,
        effort: taskModel.effort,
        allowedTools: resolved.allowedTools,
        disallowedTools: resolved.disallowedTools,
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

  // Not-needed tasks were never work, so they leave the denominator too.
  const notRequired = summary[TaskStatus.Skipped];

  // A drain that ends with failed tasks (retries exhausted) or tasks still
  // pending (blocked behind a failed dependency) did NOT set PostHog up —
  // abort like a linear agent failure instead of claiming success.
  const blocked = summary[TaskStatus.Pending];
  if (summary.failed > 0 || blocked > 0) {
    const failedTypes = store
      .list()
      .filter((t) => t.status === TaskStatus.Failed)
      .map((t) => t.type)
      .join(', ');
    await wizardAbort({
      message: `The wizard was unable to set up PostHog: the ${failedTypes} step failed.\n\nPlease report this to: ${WIZARD_CONTACT_EMAIL}`,
      error: new WizardError('orchestrator drain ended with failed tasks', {
        tasks_failed: summary.failed,
        tasks_blocked: blocked,
        failed_types: failedTypes,
      }),
    });
  }

  const message = conflict
    ? 'PostHog set up, with one conflict to review.'
    : `PostHog set up: ${summary.done}/${
        summary.total - notRequired
      } steps completed${
        notRequired > 0 ? ` (${notRequired} skipped as not required)` : ''
      }.`;
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
