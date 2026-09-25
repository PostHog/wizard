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
import { failed } from '../../shared/errors';
import { RunOutcome } from '../../shared/types';
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
import { OutroKind, type TaskNotice } from '@agent/progress';
import {
  POSTHOG_DOCS_URL,
  WIZARD_CONTACT_EMAIL,
  WIZARD_OAUTH_SCOPES,
  WIZARD_PROVISIONING_SCOPES,
} from '@shared/constants';
import { installSkillById } from '@agent/tools';
import { fetchSkillMenu, type SkillEntry } from '@shared/skill-menu';
import { analytics } from '@utils/analytics';
import { ciExcludedTaskTypes } from '@utils/ci-flag-overrides';
import { logToFile } from '@utils/debug';
import { ringTerminalBell } from '@utils/terminal-bell';
import {
  AGENT_ERROR_CODE,
  classifyRunFailure,
  ErrorCodes,
  WizardError,
  type ErrorCode,
} from '@shared/errors';
import type { AgentResult } from '../../harness/types';
import type { AgentInteraction } from '@agent/progress';
import type {
  AgentFailure,
  RunConfig,
  SequenceResult,
  SequenceContext,
} from '../../shared/types';
import { createEmitSpinner } from '../../shared/progress-collector';
import { createAskBridge } from '../../shared/ask';
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
  SkipReason,
  TaskStatus,
  type QueuedTask,
  type TaskOutcome,
} from './queue';
import {
  DEFAULT_DRAIN_OPTIONS,
  drainQueue,
  RunTaskFatal,
  type RunTask,
} from './executor';
import { RunMetrics } from './run-metrics';
import { dependencyClosure, uncoveredBySink } from './queue-tools';
import { deferSeededTasks } from './seeded-deps';
import { LONGER_ASK_TIMEOUT_MS } from '@agent/wizard-ask-bridge';
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
} from '@agent/agent-prompt-loader';

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
      return 'completed';
    case TaskStatus.Failed:
      return 'failed';
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

function terminalResult(
  result: AgentResult,
): { outcome: RunOutcome.Failed; failure: AgentFailure } | undefined {
  switch (result.kind) {
    case 'success':
      return undefined;
    case 'decided_failure':
      return { outcome: RunOutcome.Failed, failure: result.failure };
    case 'abort':
      // Callers return first on the run's signal, so this abort is the agent's own.
      return {
        outcome: RunOutcome.Failed,
        failure: {
          code: AGENT_ERROR_CODE[result.classification],
          message: result.message ?? 'Agent aborted',
          error: result.error,
        },
      };
    case 'failure':
      return {
        outcome: RunOutcome.Failed,
        failure: {
          code: AGENT_ERROR_CODE[result.classification],
          message: result.message ?? 'Agent failed',
          error: result.error,
        },
      };
  }
}

function cancelledRun(): SequenceResult {
  return {
    outcome: RunOutcome.Aborted,
    failure: { code: ErrorCodes.AgentAbort, message: 'Agent run cancelled' },
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

/** The failure a preflight miss decides: three causes reach the same miss, and only one of them is a download the user can retry. */
export function skillPreflightFailure(args: {
  missing: readonly string[];
  framework: string | undefined;
  menuAvailable: boolean;
  frameworkDocsUrl: string | undefined;
}): AgentFailure {
  const { missing, framework, menuAvailable, frameworkDocsUrl } = args;
  const docsUrl = frameworkDocsUrl ?? POSTHOG_DOCS_URL;

  const { code, title, message } = ((): {
    code: ErrorCode;
    title: string;
    message: string;
  } => {
    if (!framework) {
      return {
        code: ErrorCodes.DetectNoFramework,
        title: 'Orchestrator preflight: no detected framework',
        message:
          'Could not auto-detect your framework for this project, so there are no setup instructions to run.\n' +
          "Please run the wizard from your app's root directory, or integrate manually here:\n" +
          `  ${docsUrl}`,
      };
    }
    if (!menuAvailable) {
      return {
        code: ErrorCodes.SkillMenuFetchFailed,
        title: 'Orchestrator preflight: skill menu unavailable',
        message:
          'Setup instructions for this project failed to download.\n' +
          `Please try again, or contact ${WIZARD_CONTACT_EMAIL}.\n\n` +
          'You can also set up with your agent by downloading the skills here:\n' +
          '  https://github.com/PostHog/context-mill/releases\n' +
          'or integrate manually here:\n' +
          `  ${docsUrl}`,
      };
    }
    // A docs page resolves only for a key the framework registry knows, so its
    // absence marks an internal id that would mean nothing to the user.
    const subject = frameworkDocsUrl ? framework : 'this project';
    return {
      code: ErrorCodes.AgentOrchestratorSkillVariantMissing,
      title: 'Orchestrator preflight: skill variant missing',
      message:
        `The wizard has no setup instructions for ${subject} yet.\n` +
        'You can integrate manually here:\n' +
        `  ${docsUrl}\n\n` +
        `Please tell us what you are building: ${WIZARD_CONTACT_EMAIL}`,
    };
  })();

  return {
    code,
    message,
    error: new WizardError(
      title,
      { missing: missing.join(', '), framework },
      code,
    ),
  };
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
 * The framework reference is the full `integration` skill. `input.skillId` is
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
 * How long an optional step's notice waits for an answer.
 *
 * Much shorter than LONGER_ASK_TIMEOUT_MS, because it is asking for something
 * much smaller: one keypress to accept or decline, not "go mint a restricted
 * Stripe key". It cannot be unbounded either — the notice is a modal, and a run
 * that stops forever behind one nobody is looking at is worse than one that
 * takes the safe answer and carries on.
 *
 * The offer is made at seed time, seconds into the run, so five minutes is a
 * generous allowance for a person who is by then still watching the wizard
 * start. It was not: from 2.63.0 to 2.65.0 the offer was made at the moment the
 * step became runnable — a median seven minutes in, after every coding task —
 * and this timeout became the answer for about a quarter of all runs.
 */
export const TASK_NOTICE_TIMEOUT_MS = 5 * 60 * 1000;

interface SeededTaskOptions {
  timeoutMs?: number;
  interaction?: AgentInteraction;
  signal?: AbortSignal;
}

/**
 * Offer an optional step, defaulting to declining it if nobody answers.
 *
 * Skip is the right default on a timeout: continuing would send the step on to
 * ask for credentials that the same absent user cannot supply either, burning
 * {@link LONGER_ASK_TIMEOUT_MS} per question before falling back to the same
 * links declining gives immediately.
 */
export async function offerSeededTask(
  notice: TaskNotice,
  {
    timeoutMs = TASK_NOTICE_TIMEOUT_MS,
    interaction,
    signal,
  }: SeededTaskOptions = {},
): Promise<{ keep: boolean; timedOut: boolean }> {
  if (signal?.aborted) return { keep: false, timedOut: false };
  // No one to show the notice to: a step nobody can answer for must not run.
  // The same answer a non-interactive host gives today.
  if (!interaction?.taskNotice) return { keep: false, timedOut: false };
  const { taskNotice } = interaction;

  // This notice's own signal: its timeout or the run's cancellation aborts it.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let cancelForAbort: (() => void) | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      // Settle first: a host that rejects once dismissed must not win.
      resolve(false);
      // The host dismisses this notice's overlay and settles its promise too,
      // so the losing side of the race cannot leave a modal on screen.
      controller.abort();
    }, timeoutMs);
  });
  const aborted = new Promise<boolean>((resolve) => {
    cancelForAbort = () => {
      resolve(false);
      controller.abort();
    };
    signal?.addEventListener('abort', cancelForAbort, { once: true });
  });
  try {
    const keep = await Promise.race([
      taskNotice(notice, { signal: controller.signal }),
      timeout,
      aborted,
    ]);
    return { keep, timedOut };
  } finally {
    if (timer) clearTimeout(timer);
    if (cancelForAbort) signal?.removeEventListener('abort', cancelForAbort);
  }
}

/**
 * Which runner-seeded task types finished successfully.
 *
 * Handed to the program's `buildOutroNextSteps` so it can drop a next step its
 * own seeded task already carried out. Only `Done` counts: a skipped, declined
 * or failed step left the work undone, and that is exactly when the outro
 * bullet pointing at the app is the one thing the user still needs.
 */
export function completedSeededTypes(
  store: QueueStore,
  seededTasks: readonly QueuedTask[],
): string[] {
  return seededTasks
    .filter((task) => store.get(task.id)?.status === TaskStatus.Done)
    .map((task) => task.type);
}

/** One seeded task's answer to its notice, taken once, at seed time. */
export interface SeededConsent {
  keep: boolean;
  timedOut: boolean;
  /** The notice could not be shown at all. Read as a decline, never as a yes. */
  errored: boolean;
}

/** Which skip reason a negative {@link SeededConsent} carries onto the event. */
export function consentSkipReason(consent: SeededConsent): SkipReason {
  if (consent.errored) return SkipReason.NoticeError;
  return consent.timedOut ? SkipReason.NoticeTimeout : SkipReason.UserDeclined;
}

/**
 * Apply the seed-time answers to the queue, before the drain starts.
 *
 * A declined task is skipped rather than dropped, so the graph the planner saw
 * is the graph that ran — the sink already depends on this task, and
 * `nextRunnable` treats a skipped dependency as satisfied, so the report still
 * runs and can say the step was declined. The decline also stays in the funnel,
 * arriving as a `skipped` event carrying the reason that caused it rather than
 * as a task that silently never existed.
 *
 * It happens here rather than inside `runTask` because the executor marks a
 * task running — and fires `orchestrator task started` — before it hands the
 * task over. A decline applied on the far side of that emitted a start for a
 * task no agent ever ran, so every rate measured against starts counted the
 * declines twice: once in the denominator as a task that began, and again in
 * the numerator as a task that was skipped. Nothing upstream of the drain reads
 * task status, so applying the answers here changes only what the drain sees.
 *
 * Returns how many tasks were skipped, so the caller can redraw once.
 */
export function skipDeclinedSeededTasks(
  store: Pick<QueueStore, 'get' | 'skip'>,
  consentByTaskId: ReadonlyMap<string, SeededConsent>,
  labelFor: (task: { type: string; label?: string }) => string,
): number {
  let skipped = 0;
  for (const [taskId, consent] of consentByTaskId) {
    if (consent.keep) continue;
    const task = store.get(taskId);
    if (!task) continue;
    const reason = consentSkipReason(consent);
    logToFile(`[orchestrator] runner-seeded ${task.type} skipped: ${reason}`);
    const declinedByUser = reason === SkipReason.UserDeclined;
    store.skip(taskId, reason, {
      goals: labelFor(task),
      did: declinedByUser
        ? 'Nothing — the user chose to skip this step when offered it.'
        : 'Nothing — the step was offered at the start of the run and never accepted.',
      forNextAgent: declinedByUser
        ? 'This step was offered and declined, so it did no work. Report it as skipped at the user’s request, not as failed.'
        : 'This step was offered and never accepted, so it did no work. Report it as not set up, and point the user at how to do it later.',
    });
    skipped += 1;
  }
  return skipped;
}

/**
 * Ask for one seeded task's consent, and record how the answer came about.
 *
 * Consent and execution are separate concerns, and this is the consent half.
 * It runs at seed time — seconds into the run, with the user still watching —
 * while `seeded-deps.ts` keeps the work itself at the end of the queue. Asking
 * at the moment of execution instead, as 2.63.0 did, put the question in front
 * of a user who had long since tabbed away.
 *
 * Fails closed. The step this gates goes on to ask for live database and API
 * credentials, so a question that could not be put to the user is never read as
 * a yes.
 */
export async function askSeededConsent(
  type: string,
  notice: TaskNotice,
  options: SeededTaskOptions = {},
): Promise<SeededConsent> {
  const consent = await offerSeededTask(notice, options).then(
    (answer): SeededConsent => ({ ...answer, errored: false }),
    (err: unknown): SeededConsent => {
      logToFile(
        `[orchestrator] notice failed for ${type}, declining: ${String(err)}`,
      );
      analytics.captureException(
        err instanceof Error ? err : new Error(String(err)),
        { step: 'orchestrator_task_notice' },
      );
      return { keep: false, timedOut: false, errored: true };
    },
  );
  analytics.wizardCapture('orchestrator task notice answered', {
    type,
    kept: consent.keep,
    timed_out: consent.timedOut,
    errored: consent.errored,
  });
  return consent;
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
  blockedTypes: string[];
} {
  const failed = tasks.filter((t) => t.status === TaskStatus.Failed);
  const pending = tasks.filter((t) => t.status === TaskStatus.Pending);
  return {
    requiredFailedTypes: failed
      .filter((t) => t.optional !== true)
      .map((t) => t.type),
    optionalFailedTypes: failed
      .filter((t) => t.optional === true)
      .map((t) => t.type),
    blocked: pending.length,
    blockedTypes: pending.map((t) => t.type),
  };
}

/**
 * The one-line "what went wrong" the abort message leads with.
 *
 * Both halves are named. A drain that ends with work still pending used to
 * report only how many steps never ran, which is the least useful fact about
 * them: a user who agreed to connect their data sources and then read that
 * "2 steps never ran" had no way to tell whether that step was one of them.
 */
export function describeDrainFailure(verdict: {
  requiredFailedTypes: string[];
  blockedTypes: string[];
}): string {
  const parts: string[] = [];
  if (verdict.requiredFailedTypes.length > 0) {
    parts.push(`the ${verdict.requiredFailedTypes.join(', ')} step failed`);
  }
  if (verdict.blockedTypes.length > 0) {
    parts.push(
      `the ${verdict.blockedTypes.join(', ')} step${
        verdict.blockedTypes.length === 1 ? '' : 's'
      } never ran`,
    );
  }
  return parts.join(', so ');
}

/** One `orchestrator task blocked` event per pending task, best effort once the outcome is decided. */
function reportBlockedTasks(
  tasks: readonly QueuedTask[],
  failedTypes: readonly string[],
): void {
  for (const task of tasks) {
    if (task.status !== TaskStatus.Pending) continue;
    try {
      analytics.wizardCapture('orchestrator task blocked', {
        type: task.type,
        optional: task.optional === true,
        failed_types: failedTypes.join(',') || 'none',
      });
    } catch {
      // Reporting must not replace the run result.
    }
  }
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

/**
 * The run's excluded task types: CI gates plus the program's flag mapping.
 * Exported so a test can pin the flag→exclusion hookup against the real
 * program config — the registry and seed note both read this one list.
 */
export function effectiveExcludedTaskTypes(
  source: Pick<RunConfig, 'excludedTaskTypes'>,
  flags: Record<string, string>,
): string[] {
  return [
    ...ciExcludedTaskTypes(),
    ...(source.excludedTaskTypes?.(flags) ?? []),
  ];
}

export async function runOrchestrator(
  context: SequenceContext,
): Promise<SequenceResult> {
  const controller = new AbortController();
  const abortFromHost = () => controller.abort();
  context.signal?.addEventListener('abort', abortFromHost, { once: true });
  if (context.signal?.aborted) abortFromHost();
  let cleaned = false;
  const cleanupQueue = (): void => {
    if (cleaned) return;
    cleaned = true;
    try {
      rmSync(path.join(context.input.installDir, QUEUE_DIR_NAME), {
        recursive: true,
        force: true,
      });
    } catch (error) {
      try {
        analytics.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { step: 'orchestrator_cache_cleanup' },
        );
      } catch {
        // Cleanup reporting must not replace the run result.
      }
    }
  };
  try {
    return await executeOrchestrator(
      { ...context, signal: controller.signal },
      cleanupQueue,
      controller,
    );
  } finally {
    context.signal?.removeEventListener('abort', abortFromHost);
    cleanupQueue();
  }
}

async function executeOrchestrator(
  { config, input, boot, emit, interaction, signal }: SequenceContext,
  cleanupQueue: () => void,
  controller: AbortController,
): Promise<SequenceResult> {
  if (signal?.aborted) return cancelledRun();
  const runId = randomUUID();
  const { run } = config;
  const programId = config.programId;

  // Switchboard context — reused for every per-role harness resolution below.
  // The caller resolved the run-level binding from it; per-task roles overlay
  // `binding.contextMillOverride[role]` on the same inputs.
  const switchboardCtx = { ...config.switchboard, trace: undefined };

  // The WHAT (agent prompts) is served from context-mill. Fetch the registry
  // once up front: its types drive enqueue validation, and resolving a task to
  // its run config is then synchronous, with no mid-drain network latency.
  const flow = config.agentFlow ?? programId;
  const registry = await loadAgentRegistry(boot.skillsBaseUrl, flow, {
    exclude: effectiveExcludedTaskTypes(config, boot.wizardFlags),
    // Baked into the prompts at load, so enqueue, dispatch, and telemetry all read one effective spec.
    overrides: resolveStageOverrides(
      programId,
      boot.wizardFlags,
      boot.wizardFlagPayloads,
    ),
  });
  if (signal?.aborted) return cancelledRun();
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

  const store = new QueueStore(input.installDir, runId, {
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
            // Additive: the event's name and every other property are unchanged,
            // so existing dashboards keep reading. Without this a step the user
            // declined, a step nobody answered for, and a step the agent found
            // did not apply were one number — which is how a regression that
            // halved the warehouse completion rate stayed invisible for a week.
            reason: task.skipReason,
            // Also additive, and only ever set alongside `agent-not-needed`:
            // that reason names the agent as the decider without saying what it
            // decided, so a step the user withheld a credential for counted as
            // a step that did not apply to the project.
            not_needed_reason: task.notNeededReason,
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
  if (signal?.aborted) return cancelledRun();
  // The framework key for reference + variant resolution. `input.integration`
  // is the detected framework and always wins; `input.skillId` is the
  // fallback for the basic-integration path, where the caller sets it to the
  // framework label. Programs whose run config carries their own skill id
  // (agent-skill commands like replay-vision) would otherwise leak that id in
  // here as a bogus framework after the caller overwrites the detect result.
  const framework = input.integration ?? input.skillId ?? undefined;
  const referenceSkillId = framework
    ? resolveReferenceSkillId(menuSkillEntries, framework)
    : undefined;
  if (referenceSkillId) {
    const ref = await installSkillById(
      referenceSkillId,
      input.installDir,
      boot.skillsBaseUrl,
      {
        skillsRoot: path.join(QUEUE_DIR_NAME, 'reference'),
        triage: boot.triageProvider,
      },
    );
    if (signal?.aborted) return cancelledRun();
    if (ref.kind === 'ok') {
      referenceInstallPath = ref.path;
      const example = path.join(ref.path, 'references', 'EXAMPLE.md');
      if (existsSync(path.join(input.installDir, example))) {
        examplePath = example;
      }
      const commandments = path.join(ref.path, 'references', 'COMMANDMENTS.md');
      if (existsSync(path.join(input.installDir, commandments))) {
        commandmentsPath = commandments;
      }
    } else {
      logToFile(
        `[orchestrator] reference unavailable: ${ref.kind} (${referenceSkillId})`,
      );
    }
  } else if (framework) {
    logToFile(
      `[orchestrator] no integration skill for framework "${framework}"`,
    );
  }

  // Preflight every task's mini-skills: a miss would run tasks skill-less, so fail properly instead.
  const missingVariants: string[] = [];
  for (const type of registry.types) {
    for (const skillId of registry.get(type)?.skills ?? []) {
      if (resolveSkillVariantId(menuSkillEntries, skillId, framework)) {
        continue;
      }
      missingVariants.push(`${type}/${skillId}`);
      logToFile(
        `[orchestrator] no skill variant type=${type} skill=${skillId} framework=${
          framework ?? 'none'
        }`,
      );
      analytics.wizardCapture('orchestrator skill variant missing', {
        task_type: type,
        skill: skillId,
        framework,
      });
    }
  }
  if (missingVariants.length > 0) {
    return failed(
      skillPreflightFailure({
        missing: missingVariants,
        framework,
        menuAvailable: menuSkillEntries.length > 0,
        // The framework's own docs page, resolved by the caller.
        frameworkDocsUrl: input.frameworkDocsUrl,
      }),
    );
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
    `[orchestrator] START program=${programId} dir=${input.installDir} run=${runId}`,
  );
  analytics.wizardCapture('orchestrator started', {
    program_id: programId,
  });
  emit({ kind: 'lifecycle', phase: 'started' });

  // Label precedence: what the orchestrator set at enqueue, then the agent
  // prompt's default, then the bare type.
  const labelFor = (t: { type: string; label?: string }) =>
    t.label ?? registry.get(t.type)?.label ?? t.type;
  const renderQueue = () =>
    emit({
      kind: 'tasks',
      tasks: displayOrder(store.list(), (t) =>
        registry.runnerSeededTypes.includes(t.type),
      ).map((t) => ({
        id: `${runId}:${t.id}`,
        source: runId,
        content: labelFor(t),
        status: toTodoStatus(t.status),
        activeForm: labelFor(t),
      })),
    });

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
    // Optionality comes from the task's frontmatter, never from the enqueue call.
    optionalTypes: registry.optionalTypes,
    currentTaskId,
  });

  // Tasks the wizard queues itself, from what detection found. They exist
  // before the planner runs, so the sink guard forces the reporting task to
  // depend on them, and no prompt has to remember they are there.
  // Kill switch: off (or unset), the wizard queues nothing itself and the run
  // is byte-identical to a project with no detected sources.
  const seedEntries = areSeededTasksEnabled(boot.wizardFlags)
    ? config.seedTasks?.() ?? []
    : [];
  const seededTypes: string[] = [];
  // Kept so their dependencies can be resolved once the planner has run — they
  // are queued before it, so they cannot name what they wait for yet.
  const seededTasks: QueuedTask[] = [];
  // Each seeded task's answer to its notice, taken here and applied later.
  //
  // Consent belongs at seed time: the user is at the keyboard, watching the run
  // start, and one keypress is all the question needs. The work does not — the
  // warehouse step asks for credentials, and those questions belong after the
  // autonomous coding, which is what `seeded-deps.ts` arranges. 2.63.0 collapsed
  // the two onto one modal at the moment of execution, a median seven minutes
  // in, by which time the user had gone; the five-minute timeout then answered
  // for them, and it answers "skip".
  //
  // The answer is recorded rather than acted on, so a declined task still enters
  // the queue as an ordinary pending task. The planner plans around it,
  // `deferSeededTasks` can still add its edges, and the sink invariant still
  // covers it — none of which is true of a task that was enqueued and skipped
  // before the planner ever ran. `runTask` applies the answer when the drain
  // reaches the task.
  const seededConsent = new Map<string, SeededConsent>();
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
    if (seeded.notice) {
      // Awaited inside the loop, so at most one notice is ever on screen. The
      // store holds a single pending-notice slot: a second `showTaskNotice`
      // overwrites the first's resolver, the first promise never settles, and
      // its task hangs for the rest of the run. A serial loop makes that
      // unreachable; the drain, which starts every runnable task at once, does
      // not, which is why the offer lives here and not there.
      seededConsent.set(
        task.id,
        await askSeededConsent(seeded.type, seeded.notice, {
          interaction,
          signal,
        }),
      );
      if (signal?.aborted) return cancelledRun();
    }
    logToFile(`[orchestrator] runner-seeded task ${seeded.type}`);
  }

  // A run that stops to ask a person is not comparable with one that does not
  // — its wall-clock is the user's, not the model's. Tag every event of the run
  // from here on, so those runs filter out cleanly.
  //
  // A declined step asks nothing, and the answer is known by now, so it leaves
  // the tag alone. While the offer was made mid-drain this was unknowable here,
  // and roughly a quarter of runs were tagged as waiting on a user who had in
  // fact already been auto-declined out of the only step that asks.
  const askingTypes = seededTasks
    .filter((task) => seededConsent.get(task.id)?.keep !== false)
    .map((task) => task.type)
    .filter((type) => canAsk(registry.get(type)));
  analytics.setTag('orchestrator_awaits_user', askingTypes.length > 0);
  analytics.setTag(
    'orchestrator_runner_seeded_types',
    seededTypes.join(',') || 'none',
  );
  if (askingTypes.length > 0) {
    analytics.wizardCapture('orchestrator awaits user', {
      task_types: askingTypes,
      ask_timeout_ms: LONGER_ASK_TIMEOUT_MS,
    });
  }

  // One bridge for the run, handed only to a task whose prompt allows asking.
  // Absent in CI and signup, where nobody can answer.
  const askBridge = shouldDisableAsk(input.flags)
    ? undefined
    : createAskBridge(interaction, {
        signal,
        getSource: () => input.skillId ?? programId,
        beforeShow: () => {
          // How late the first ask lands is the measure of this run shape: it
          // should follow the autonomous work, not interrupt it.
          metrics.recordAsk(Date.now());
          // Consent is taken in the first seconds of the run and these questions
          // arrive at the end of it, so the user who agreed may well be looking
          // at another window by now. Nothing here waits on the bell — an
          // unanswered ask still times out into the deep-link fallback — it just
          // gives a person who stepped away a chance to come back first.
          ringTerminalBell();
        },
        richLinks: run.richLinks ?? false,
        // A task ask waits on a person, and the drain waits it out — the
        // executor holds the task's promise — so this is the only real limit.
        timeoutMs: LONGER_ASK_TIMEOUT_MS,
      });

  const spinner = createEmitSpinner(emit);

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
    signal,
    config,
    input,
    boot,
    emit,
    // The exclusion note names `registry.excludedTypes` — the excluded types
    // this flow actually had — so the planner never hears about work that was
    // never available, and overlapping exclusion sources cannot double-list.
    prompt: assembleSeedPrompt(
      promptContext,
      seedPrompt.body,
      store.list(),
      registry.excludedTypes,
    ),
    spinner,
    model: requireKnownModel(seedModel.model, seedPick.model),
    effort: seedModel.effort,
    ...agentRunTools(seedPrompt),
    orchestrator: orchestratorCtx(),
    spinnerMessage: 'Planning the integration...',
    successMessage: 'Planned the integration',
    requestRemark: false,
    analyticsProperties: { task_type: 'seed', harness: seedPick.harness },
  });
  if (signal?.aborted) return cancelledRun();
  const seedTerminal = terminalResult(seedResult);
  if (seedTerminal) return seedTerminal;
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
    return failed({
      code: ErrorCodes.AgentOrchestratorSinkInvariant,
      message: `The wizard could not plan this setup: the final step would have skipped ${unwaited
        .map((t) => t.type)
        .join(', ')}.\n\nPlease report this to: ${WIZARD_CONTACT_EMAIL}`,
      error: new WizardError(
        'orchestrator sink does not cover the queue',
        {
          uncovered: unwaited.map((t) => `${t.type} (${t.id})`).join(', '),
          queue_state: JSON.stringify(store.list()),
        },
        ErrorCodes.AgentOrchestratorSinkInvariant,
      ),
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
  const claudeSkillsDir = path.join(input.installDir, '.claude', 'skills');
  const preexistingSkills = new Set(
    existsSync(claudeSkillsDir) ? readdirSync(claudeSkillsDir) : [],
  );
  const runTask: RunTask = async (task) => {
    if (signal?.aborted) return;
    renderQueue();

    try {
      const resolved = resolveTask(registry, task, store);
      // Task instructions are one-run scaffolding, not durable skills, so they
      // install under the run dir rather than .claude/skills — the SDK must not
      // auto-load them and they must never land in the project (or a CI PR).
      // The prompt points the agent at them instead.
      const skillPaths: string[] = [];
      for (const skillId of resolved.skills) {
        if (signal?.aborted) return;
        // Agent prompts name the bare step-skill (`integration-v2-install`);
        // SDK-divergent steps ship per-framework variants, so resolve against
        // the menu with the session's framework before installing.
        const variantId = resolveSkillVariantId(
          menuSkillEntries,
          skillId,
          framework,
        );
        if (!variantId) {
          logToFile(
            `[orchestrator] no skill variant type=${
              task.type
            } skill=${skillId} framework=${framework ?? 'none'}`,
          );
          continue;
        }
        const result = await installSkillById(
          variantId,
          input.installDir,
          boot.skillsBaseUrl,
          { skillsRoot: taskSkillsRoot, triage: boot.triageProvider },
        );
        if (signal?.aborted) return;
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
      let taskResult: AgentResult;
      try {
        taskResult = await taskHarness.runTask({
          signal,
          config,
          input,
          boot,
          emit,
          prompt: assembleTaskPrompt(
            promptContext,
            resolved.prompt,
            skillPaths,
          ),
          spinner,
          model: requireKnownModel(taskModel.model, taskPick.model),
          effort: taskModel.effort,
          allowedTools: resolved.allowedTools,
          disallowedTools: resolved.disallowedTools,
          askBridge: canAsk(registry.get(task.type)) ? askBridge : undefined,
          orchestrator: orchestratorCtx(task.id),
          spinnerMessage: '',
          successMessage: '',
          requestRemark: false,
          analyticsProperties: {
            task_type: task.type,
            task_id: task.id,
            harness: taskPick.harness,
          },
        });
      } catch (error) {
        if (signal?.aborted) return;
        if (error instanceof RunTaskFatal) throw error;
        const failure = classifyRunFailure(error);
        throw new RunTaskFatal(
          {
            code: failure.code,
            message: failure.message,
            error: error instanceof Error ? error : undefined,
          },
          RunOutcome.Failed,
          task.type,
        );
      }
      if (signal?.aborted) return;
      const terminal = terminalResult(taskResult);
      if (terminal)
        throw new RunTaskFatal(terminal.failure, terminal.outcome, task.type);
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
        try {
          logToFile('[orchestrator] per-task skill sweep failed:', err);
        } catch {
          // Cleanup logging must not replace the task result.
        }
      }
      try {
        renderQueue();
      } catch (err) {
        try {
          logToFile('[orchestrator] per-task queue render failed:', err);
        } catch {
          // Cleanup logging must not replace the task result.
        }
      }
    }
  };
  // A task that stops for the user is offered, not imposed, and the answer was
  // taken at seed time. Apply it before the drain begins, so the drain only
  // ever starts tasks that are going to run.
  if (skipDeclinedSeededTasks(store, seededConsent, labelFor) > 0) {
    renderQueue();
  }

  let fatal: RunTaskFatal | undefined;
  try {
    await drainQueue(store, runTask, {
      ...DEFAULT_DRAIN_OPTIONS,
      signal,
      onFatal: () => controller.abort(),
    });
  } catch (error) {
    if (!(error instanceof RunTaskFatal)) throw error;
    fatal = error;
  } finally {
    // The queue file is wiped below; the e2e harness reads outcomes from here.
    config.hooks?.recordTaskOutcomes?.(
      store.list().map((t) => ({
        type: t.type,
        status: t.status,
        optional: t.optional === true,
      })) satisfies TaskOutcome[],
    );
    try {
      if (!signal?.aborted && referenceSkillId && referenceInstallPath) {
        promoteReferenceSkill(
          path.join(input.installDir, referenceInstallPath),
          claudeSkillsDir,
          referenceSkillId,
        );
      }
    } catch (err) {
      try {
        analytics.captureException(
          err instanceof Error ? err : new Error(String(err)),
          { step: 'orchestrator_reference_promote' },
        );
      } catch {
        // Cleanup reporting must not replace the run result.
      }
    }
    cleanupQueue();
    try {
      sweepRunInstalledSkills(
        claudeSkillsDir,
        preexistingSkills,
        referenceSkillId,
      );
    } catch (err) {
      try {
        analytics.captureException(
          err instanceof Error ? err : new Error(String(err)),
          { step: 'orchestrator_skill_sweep' },
        );
      } catch {
        // Cleanup reporting must not replace the run result.
      }
    }
  }

  if (fatal) {
    // The steps the fatal task stopped still get their terminal event.
    const stoppedBy = drainVerdict(store.list()).requiredFailedTypes;
    if (fatal.taskType && !stoppedBy.includes(fatal.taskType)) {
      stoppedBy.push(fatal.taskType);
    }
    reportBlockedTasks(store.list(), stoppedBy);
    return { outcome: fatal.outcome, failure: fatal.failure };
  }
  if (signal?.aborted) return cancelledRun();

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
  // A pending task at this point never ran and never will — its dependency
  // failed. No transition fires for it, so without this the step leaves no
  // terminal event at all: a step the user was offered and accepted simply
  // drops out of the funnel. The queue itself is left alone, because the run
  // cache is already wiped by here and writing to it would recreate the folder
  // the cleanup just removed.
  reportBlockedTasks(store.list(), verdict.requiredFailedTypes);
  if (verdict.requiredFailedTypes.length > 0 || blocked > 0) {
    const failedTypes = verdict.requiredFailedTypes.join(', ');
    const whatFailed = describeDrainFailure(verdict);
    // A grant narrowed at login is the one failure cause the user can fix
    // alone — lead with the fix, and only fall back to the report-a-bug line
    // when trying again doesn't work.
    const missingScopes = (boot.credentials.missingScopes ?? []).filter(
      (scope) =>
        WIZARD_PROVISIONING_SCOPES.some((required) => required === scope) ||
        !WIZARD_OAUTH_SCOPES.some((requested) => requested === scope),
    );
    const message =
      missingScopes.length > 0
        ? `The wizard could not finish setup: ${whatFailed}, and this run was authorized without the following permission${
            missingScopes.length === 1 ? '' : 's'
          }: ${missingScopes.join(
            ', ',
          )}.\n\nPlease try again, approving all permissions on the PostHog authorization screen. If it still fails, report it to: ${WIZARD_CONTACT_EMAIL}`
        : `The wizard was unable to set up PostHog: ${whatFailed}.\n\nPlease report this to: ${WIZARD_CONTACT_EMAIL}`;
    return failed({
      code: ErrorCodes.AgentOrchestratorTasksFailed,
      message,
      error: new WizardError(
        'orchestrator drain ended with failed tasks',
        {
          tasks_failed: summary.failed,
          tasks_blocked: blocked,
          failed_types: failedTypes,
          missing_oauth_scopes: missingScopes.join(' '),
          queue_state: JSON.stringify(store.list()),
        },
        ErrorCodes.AgentOrchestratorTasksFailed,
      ),
    });
  }

  // A drain that produced no tasks at all means the seed step never got a
  // usable model response (e.g. the gateway returned empty completions).
  // "0/0 completed" is a dead run, not a success with an empty denominator.
  if (summary.total === 0) {
    return failed({
      code: ErrorCodes.AgentOrchestratorHollowRun,
      message: `The wizard was unable to set up PostHog: the planning step produced no work, so nothing ran.\n\nPlease try again — and if it happens again, report it to: ${WIZARD_CONTACT_EMAIL}`,
      error: new WizardError(
        'orchestrator drain produced zero tasks',
        { queue_state: JSON.stringify(store.list()) },
        ErrorCodes.AgentOrchestratorHollowRun,
      ),
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
  const outro = {
    kind: OutroKind.Success,
    message,
    body: conflict
      ? `⚠ Build conflict: ${conflict}\nFull details are in the setup report.`
      : undefined,
    docsUrl: 'https://posthog.com/docs/ai-engineering/ai-wizard',
    nextSteps: config.hooks?.buildOutroNextSteps?.(
      boot.credentials,
      completedSeededTypes(store, seededTasks),
    ),
  };
  emit({ kind: 'completion', outro });
  emit({ kind: 'lifecycle', phase: 'completed', message });
  return { outcome: RunOutcome.Success, outro };
}
