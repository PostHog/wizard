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
import {
  applyComplete,
  applyEnqueue,
  applyReadHandoffs,
  HANDOFF_FIELDS,
  NOT_NEEDED_REASON_ASK,
  REMARK_ASK,
  type CompleteArgs,
  type EnqueueArgs,
  type OrchestratorToolsContext,
} from '../../sequence/orchestrator/queue-tools';
import { NotNeededReason } from '../../sequence/orchestrator/queue';

function text(s: string): {
  content: [{ type: 'text'; text: string }];
  details: unknown;
} {
  return { content: [{ type: 'text', text: s }], details: {} };
}

/** Mirrors the zod `HANDOFF_SHAPE`; both read their text from HANDOFF_FIELDS. */
const HANDOFF_PARAMS = Type.Object({
  goals: Type.String({ description: HANDOFF_FIELDS.goals }),
  did: Type.String({ description: HANDOFF_FIELDS.did }),
  forNextAgent: Type.String({ description: HANDOFF_FIELDS.forNextAgent }),
  filesTouched: Type.Optional(
    Type.Array(Type.String(), { description: HANDOFF_FIELDS.filesTouched }),
  ),
  evidence: Type.Optional(
    Type.String({ description: HANDOFF_FIELDS.evidence }),
  ),
  assumptions: Type.Optional(
    Type.String({ description: HANDOFF_FIELDS.assumptions }),
  ),
  conflict: Type.Optional(
    Type.String({ description: HANDOFF_FIELDS.conflict }),
  ),
  reportSection: Type.Optional(
    Type.String({ description: HANDOFF_FIELDS.reportSection }),
  ),
});

/** Exported so the parity test can compare both harnesses' field sets. */
export const PI_HANDOFF_PARAM_KEYS: readonly string[] = Object.keys(
  HANDOFF_PARAMS.properties,
);

/** Mirrors the zod `COMPLETE_SHAPE`; ctx-independent, so it lives out here. */
const COMPLETE_PARAMS = Type.Object({
  status: Type.Union([
    Type.Literal('done'),
    Type.Literal('failed'),
    Type.Literal('not needed'),
  ]),
  handoff: HANDOFF_PARAMS,
  remark: Type.Optional(Type.String({ description: REMARK_ASK })),
  notNeededReason: Type.Optional(
    Type.Union(
      [
        Type.Literal(NotNeededReason.NotApplicable),
        Type.Literal(NotNeededReason.UserDeclined),
        Type.Literal(NotNeededReason.Blocked),
      ],
      { description: NOT_NEEDED_REASON_ASK },
    ),
  ),
});

/** Exported so the parity test can compare both harnesses' field sets. */
export const PI_COMPLETE_PARAM_KEYS: readonly string[] = Object.keys(
  COMPLETE_PARAMS.properties,
);

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
    parameters: COMPLETE_PARAMS,
    execute(_id, args) {
      const res = applyComplete(ctx, args as CompleteArgs);
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
