/**
 * Orchestrator queue tools as pi custom tools. The queue lives in-process, and
 * `applyEnqueue` / `applyComplete` / `applyReadHandoffs` are plain exported
 * functions — so pi needs no MCP transport, just `defineTool` wrappers around
 * the same guards and apply logic the anthropic path mounts through the
 * wizard-tools MCP server. Tool names match the MCP short names so the shared
 * agent prompts are unchanged.
 *
 * Lazily imported (typebox is ESM and must stay out of the static module graph
 * so CommonJS unit tests can load the backend seam without parsing it).
 */

import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { analytics } from '@utils/analytics';
import { REMARK_ASK } from '@lib/agent/signals';
import {
  applyComplete,
  applyEnqueue,
  applyReadHandoffs,
  type EnqueueArgs,
  type OrchestratorToolsContext,
} from '../../sequence/orchestrator/queue-tools';
import type { TaskHandoff } from '../../sequence/orchestrator/queue';

function text(s: string): {
  content: [{ type: 'text'; text: string }];
  details: unknown;
} {
  return { content: [{ type: 'text', text: s }], details: {} };
}

const HANDOFF_PARAMS = Type.Object({
  goals: Type.String({ description: 'What this task was asked to achieve.' }),
  did: Type.String({
    description:
      'What you actually did — for each file you edited: the change, the intention behind it, and the analytics it should feed (the insight, funnel, or dashboard tile it becomes part of).',
  }),
  forNextAgent: Type.String({
    description: 'What the next agent should know.',
  }),
  filesTouched: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Paths of every file you edited.',
    }),
  ),
  evidence: Type.Optional(
    Type.String({
      description:
        'How you know it worked — what you ran or observed, not what you expect.',
    }),
  ),
  assumptions: Type.Optional(
    Type.String({
      description: 'What you assumed about the app and could not verify.',
    }),
  ),
  conflict: Type.Optional(
    Type.String({
      description:
        'A one-line summary of any conflict you could not cleanly resolve (e.g. a dependency or build conflict). Put full detail in your work; this line is surfaced to the user.',
    }),
  ),
});

/** The three queue tools bound to one agent's orchestrator context. */
export function createPiOrchestratorTools(
  ctx: OrchestratorToolsContext,
): ToolDefinition[] {
  const enqueueTask = defineTool({
    name: 'enqueue_task',
    label: 'Enqueue task',
    description:
      'Add a task to the orchestrator queue. Use it to seed work and to enqueue follow-up work you discover. Keep tasks small and discrete.',
    promptSnippet:
      'enqueue_task(type, label, dependsOn, reason) — add a task to the queue; returns its id',
    parameters: Type.Object({
      type: Type.String({
        description: `The task type. One of: ${ctx.validTypes.join(', ')}.`,
      }),
      label: Type.Optional(
        Type.String({
          description:
            'A short label for the UI — the action in a few words (e.g. "Add the PostHog SDK", "Initialize PostHog"). Leave out file names, class names, and other specifics.',
        }),
      ),
      inputs: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      dependsOn: Type.Optional(
        Type.Array(Type.String(), {
          description: 'Task ids that must be done before this task runs.',
        }),
      ),
      model: Type.Optional(Type.String()),
      reason: Type.String({
        description: 'One line on why this task is needed.',
      }),
    }),
    execute(_id, args) {
      const res = applyEnqueue(ctx, args as EnqueueArgs);
      if (!res.ok) {
        analytics.wizardCapture('orchestrator guard tripped', {
          guard: res.guard,
          type: (args as EnqueueArgs).type,
        });
        return Promise.resolve(text(`Error: ${res.message}`));
      }
      return Promise.resolve(text(JSON.stringify({ id: res.task.id })));
    },
  });

  const completeTask = defineTool({
    name: 'complete_task',
    label: 'Complete task',
    description:
      "Report the outcome of your task. Always call this exactly once when you finish, with a structured handoff for the next agent. Use status 'not needed' when the task does not apply to this project and you cannot do it (say why in the handoff) — not 'done'.",
    promptSnippet:
      'complete_task(status, handoff) — report your outcome exactly once when done',
    parameters: Type.Object({
      status: Type.Union([
        Type.Literal('done'),
        Type.Literal('failed'),
        Type.Literal('not needed'),
      ]),
      handoff: HANDOFF_PARAMS,
      remark: Type.Optional(Type.String({ description: REMARK_ASK })),
    }),
    execute(_id, args) {
      const res = applyComplete(
        ctx,
        args as {
          status: 'done' | 'failed' | 'not needed';
          handoff: TaskHandoff;
          remark?: string;
        },
      );
      if (!res.ok) return Promise.resolve(text(`Error: ${res.message}`));
      return Promise.resolve(text('ok'));
    },
  });

  const readHandoffs = defineTool({
    name: 'read_handoffs',
    label: 'Read handoffs',
    description:
      'Read structured handoffs from earlier tasks. With no argument, returns the handoffs of your dependencies.',
    promptSnippet:
      'read_handoffs() — read what earlier tasks handed off (defaults to your dependencies)',
    parameters: Type.Object({
      type: Type.Optional(Type.String()),
      taskId: Type.Optional(Type.String()),
    }),
    execute(_id, args) {
      const handoffs = applyReadHandoffs(
        ctx,
        args as { type?: string; taskId?: string },
      );
      return Promise.resolve(text(JSON.stringify(handoffs, null, 2)));
    },
  });

  return [enqueueTask, completeTask, readHandoffs];
}
