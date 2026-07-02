/**
 * Task/todo parity for pi (#526). The same four Task tools the anthropic path
 * exposes (TaskCreate/Update/Get/List), as pi `defineTool` tools backed by a
 * shared in-memory store. Every mutation pushes the list to the TUI via
 * `getUI().syncTodos`, so the todo panel updates live under pi exactly like the
 * anthropic path — the thing that was missing before.
 */

import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { getUI } from '@ui';

export type TaskStatus = 'pending' | 'in_progress' | 'completed';
export interface TaskEntry {
  content: string;
  status: TaskStatus;
  activeForm?: string;
}
export type TaskStore = Map<string, TaskEntry>;

function text(s: string): {
  content: [{ type: 'text'; text: string }];
  details: unknown;
} {
  return { content: [{ type: 'text', text: s }], details: {} };
}

function syncToTui(store: TaskStore): void {
  getUI().syncTodos(
    Array.from(store.values()).map((t) => ({
      content: t.content,
      status: t.status,
      activeForm: t.activeForm,
    })),
  );
}

/** Build the four Task tools over a fresh store. */
export function createWizardPiTaskTools(): {
  tools: ToolDefinition[];
  store: TaskStore;
} {
  const store: TaskStore = new Map();

  const taskCreate = defineTool({
    name: 'TaskCreate',
    label: 'Create task',
    description:
      'Create a task in the shared todo list. Returns its assigned id.',
    promptSnippet:
      'TaskCreate(content) — add a todo (surfaces progress in the UI)',
    parameters: Type.Object({
      content: Type.String({ description: 'Imperative task description' }),
      activeForm: Type.Optional(
        Type.String({ description: 'Present-continuous form for the spinner' }),
      ),
    }),
    // eslint-disable-next-line @typescript-eslint/require-await -- pi tool contract returns a Promise
    async execute(_id, args) {
      const id = `task-${store.size + 1}`;
      store.set(id, {
        content: args.content,
        status: 'pending',
        activeForm: args.activeForm,
      });
      syncToTui(store);
      return text(`Created ${id}`);
    },
  });

  const taskUpdate = defineTool({
    name: 'TaskUpdate',
    label: 'Update task',
    description:
      'Update an existing task by id (status, content, or activeForm).',
    promptSnippet:
      'TaskUpdate(taskId, status) — mark a todo in_progress/completed',
    parameters: Type.Object({
      taskId: Type.String(),
      status: Type.Optional(
        Type.Union([
          Type.Literal('pending'),
          Type.Literal('in_progress'),
          Type.Literal('completed'),
        ]),
      ),
      content: Type.Optional(Type.String()),
      activeForm: Type.Optional(Type.String()),
    }),
    // eslint-disable-next-line @typescript-eslint/require-await -- pi tool contract returns a Promise
    async execute(_id, args) {
      const existing = store.get(args.taskId);
      if (!existing) return text(`No such task: ${args.taskId}`);
      store.set(args.taskId, {
        content: args.content ?? existing.content,
        status: (args.status as TaskStatus) ?? existing.status,
        activeForm: args.activeForm ?? existing.activeForm,
      });
      syncToTui(store);
      return text(`Updated ${args.taskId}`);
    },
  });

  const taskGet = defineTool({
    name: 'TaskGet',
    label: 'Get task',
    description: 'Fetch a single task by id.',
    parameters: Type.Object({ taskId: Type.String() }),
    // eslint-disable-next-line @typescript-eslint/require-await -- pi tool contract returns a Promise
    async execute(_id, args) {
      const t = store.get(args.taskId);
      return text(
        t
          ? JSON.stringify({ id: args.taskId, ...t })
          : `No such task: ${args.taskId}`,
      );
    },
  });

  const taskList = defineTool({
    name: 'TaskList',
    label: 'List tasks',
    description: 'List all tasks in the shared todo list.',
    parameters: Type.Object({}),
    // eslint-disable-next-line @typescript-eslint/require-await -- pi tool contract returns a Promise
    async execute() {
      return text(
        JSON.stringify(
          Array.from(store.entries()).map(([id, t]) => ({ id, ...t })),
        ),
      );
    },
  });

  return { tools: [taskCreate, taskUpdate, taskGet, taskList], store };
}
