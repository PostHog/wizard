/**
 * Orchestrator MCP tools, registered into the existing `wizard-tools` server when
 * a queue is present. They let the orchestrator agent and task agents grow the
 * queue, report completion with a structured handoff, and read prior handoffs.
 *
 * The guard logic and the apply functions are plain, exported, and unit-tested.
 * `buildOrchestratorTools` wraps them in the SDK `tool()` shape.
 */
import { z } from 'zod';
import { analytics } from '../../../utils/analytics';
import {
  TaskStatus,
  type QueueStore,
  type QueuedTask,
  type TaskHandoff,
} from './queue';

export interface OrchestratorToolsContext {
  store: QueueStore;
  /** Task types the registry knows about. enqueue_task rejects anything else. */
  validTypes: readonly string[];
  /**
   * The id of the task this tool server is bound to. Each task agent gets its
   * own wizard-tools server, so attribution holds when independent tasks run
   * in parallel. Absent for the seed, which is not a task.
   */
  currentTaskId?: string;
}

export interface EnqueueArgs {
  type: string;
  label?: string;
  inputs?: Record<string, unknown>;
  dependsOn?: string[];
  model?: string;
  reason: string;
}

export type GuardResult =
  | { ok: true }
  | { ok: false; guard: string; message: string };

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => a.localeCompare(b),
  );
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(',')}}`;
}

function dedupKey(type: string, inputs: Record<string, unknown>): string {
  return `${type}::${stableStringify(inputs)}`;
}

/**
 * Validate an enqueue. Structural checks only — a real type, real dependencies,
 * and not a literal duplicate. How much runs, and in what shape, is the task
 * graph's business, not a knob's.
 */
export function checkEnqueueGuards(
  ctx: OrchestratorToolsContext,
  args: EnqueueArgs,
): GuardResult {
  const tasks = ctx.store.list();

  if (!ctx.validTypes.includes(args.type)) {
    return {
      ok: false,
      guard: 'unknown-type',
      message: `Unknown task type "${
        args.type
      }". Valid types: ${ctx.validTypes.join(', ')}.`,
    };
  }

  for (const dep of args.dependsOn ?? []) {
    if (!ctx.store.get(dep)) {
      return {
        ok: false,
        guard: 'unknown-dep',
        message: `Dependency "${dep}" is not a known task id.`,
      };
    }
  }

  const key = dedupKey(args.type, args.inputs ?? {});
  if (
    tasks.some(
      (t) =>
        t.status !== TaskStatus.Failed && dedupKey(t.type, t.inputs) === key,
    )
  ) {
    return {
      ok: false,
      guard: 'dedup',
      message: `A "${args.type}" task with these inputs already exists.`,
    };
  }

  return { ok: true };
}

export type EnqueueResult =
  | { ok: true; task: QueuedTask }
  | { ok: false; guard: string; message: string };

export function applyEnqueue(
  ctx: OrchestratorToolsContext,
  args: EnqueueArgs,
): EnqueueResult {
  const guard = checkEnqueueGuards(ctx, args);
  if (!guard.ok) return guard;

  const task = ctx.store.enqueue({
    type: args.type,
    label: args.label,
    inputs: args.inputs ?? {},
    dependsOn: args.dependsOn ?? [],
    model: args.model,
    enqueuedBy: ctx.currentTaskId ?? 'orchestrator',
  });
  return { ok: true, task };
}

export type CompleteResult = { ok: true } | { ok: false; message: string };

export function applyComplete(
  ctx: OrchestratorToolsContext,
  args: { status: 'done' | 'failed' | 'skipped'; handoff: TaskHandoff },
): CompleteResult {
  const id = ctx.currentTaskId;
  if (!id) {
    return {
      ok: false,
      message: 'complete_task can only be called by a running task agent.',
    };
  }
  if (args.status === TaskStatus.Failed) {
    ctx.store.fail(
      id,
      { type: 'self-reported', message: args.handoff.forNextAgent },
      args.handoff,
    );
  } else if (args.status === TaskStatus.Skipped) {
    ctx.store.skip(id, args.handoff);
  } else {
    ctx.store.complete(id, args.handoff);
  }
  return { ok: true };
}

export function applyReadHandoffs(
  ctx: OrchestratorToolsContext,
  args: { type?: string; taskId?: string },
): TaskHandoff[] {
  if (args.taskId) {
    const h = ctx.store.readHandoff(args.taskId);
    return h ? [h] : [];
  }
  if (args.type) {
    return ctx.store.readHandoffsByType(args.type);
  }
  // No filter: every handoff of a dependency of the current task.
  const currentId = ctx.currentTaskId;
  const current = currentId ? ctx.store.get(currentId) : undefined;
  if (!current) return [];
  return current.dependsOn
    .map((depId) => ctx.store.readHandoff(depId))
    .filter((h): h is TaskHandoff => h !== null);
}

const HANDOFF_SHAPE = {
  goals: z.string().describe('What this task was asked to achieve.'),
  did: z.string().describe('What you actually did.'),
  forNextAgent: z.string().describe('What the next agent should know.'),
  filesTouched: z.array(z.string()).optional(),
  conflict: z
    .string()
    .optional()
    .describe(
      'A one-line summary of any conflict you could not cleanly resolve (e.g. a dependency or build conflict). Put full detail in your work; this line is surfaced to the user.',
    ),
};

type SdkTool = (
  name: string,
  description: string,
  // The SDK accepts a plain object of zod fields as the schema.
  schema: Record<string, z.ZodTypeAny>,
  handler: (args: never) => unknown,
) => unknown;

function textResult(text: string, isError = false) {
  return { isError, content: [{ type: 'text' as const, text }] };
}

/**
 * Build the orchestrator tools in the SDK `tool()` shape. Called from
 * createWizardToolsServer only when a queue context is present.
 */
export function buildOrchestratorTools(
  tool: SdkTool,
  ctx: OrchestratorToolsContext,
): unknown[] {
  const enqueueTask = tool(
    'enqueue_task',
    'Add a task to the orchestrator queue. Use it to seed work and to enqueue follow-up work you discover. Keep tasks small and discrete.',
    {
      type: z
        .string()
        .describe(`The task type. One of: ${ctx.validTypes.join(', ')}.`),
      label: z
        .string()
        .optional()
        .describe(
          'A short label for the UI — the action in a few words (e.g. "Add the PostHog SDK", "Initialize PostHog"). Leave out file names, class names, and other specifics.',
        ),
      inputs: z.record(z.unknown()).optional(),
      dependsOn: z
        .array(z.string())
        .optional()
        .describe('Task ids that must be done before this task runs.'),
      model: z.string().optional(),
      reason: z.string().describe('One line on why this task is needed.'),
    },
    ((args: EnqueueArgs) => {
      const res = applyEnqueue(ctx, args);
      if (!res.ok) {
        analytics.wizardCapture('orchestrator guard tripped', {
          guard: res.guard,
          type: args.type,
        });
        return textResult(res.message, true);
      }
      return textResult(JSON.stringify({ id: res.task.id }));
    }) as (args: never) => unknown,
  );

  const completeTask = tool(
    'complete_task',
    "Report the outcome of your task. Always call this exactly once when you finish, with a structured handoff for the next agent. Use status 'skipped' when the task does not apply to this project and you cannot do it (say why in the handoff) — not 'done'.",
    {
      status: z.enum(['done', 'failed', 'skipped']),
      handoff: z.object(HANDOFF_SHAPE),
    },
    ((args: {
      status: 'done' | 'failed' | 'skipped';
      handoff: TaskHandoff;
    }) => {
      const res = applyComplete(ctx, args);
      if (!res.ok) return textResult(res.message, true);
      return textResult('ok');
    }) as (args: never) => unknown,
  );

  const readHandoffs = tool(
    'read_handoffs',
    'Read structured handoffs from earlier tasks. With no argument, returns the handoffs of your dependencies.',
    {
      type: z.string().optional(),
      taskId: z.string().optional(),
    },
    ((args: { type?: string; taskId?: string }) => {
      const handoffs = applyReadHandoffs(ctx, args);
      return textResult(JSON.stringify(handoffs, null, 2));
    }) as (args: never) => unknown,
  );

  return [enqueueTask, completeTask, readHandoffs];
}
