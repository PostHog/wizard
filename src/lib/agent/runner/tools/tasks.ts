import { z } from 'zod';
import {
  ok,
  err,
  type ToolContext,
  type ToolDefinition,
  type ToolResult,
} from './types';

/**
 * Task tools (TaskCreate/Update/Get/List). They accumulate into the shared
 * task store by id — the same shape the SDK's Task* tools wrote to — so program
 * steps and the TUI todo view that read task state are unaffected. Subagent
 * dispatch via the `Task` tool is out of scope here (PR 06).
 */

function changed(ctx: ToolContext): void {
  ctx.onTasksChange?.(ctx.tasks);
}

const createSchema = z.object({
  content: z.string(),
  activeForm: z.string().optional(),
});

export const taskCreateTool: ToolDefinition = {
  name: 'TaskCreate',
  description:
    'Create a task in the shared task list. Returns its assigned id.',
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'Imperative task description' },
      activeForm: { type: 'string', description: 'Present-continuous form' },
    },
    required: ['content'],
  },
  handler(input, ctx): Promise<ToolResult> {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) {
      return Promise.resolve(
        err(`Invalid input: ${parsed.error.issues[0]?.message}`),
      );
    }
    const id = `task-${ctx.tasks.size + 1}`;
    ctx.tasks.set(id, {
      content: parsed.data.content,
      status: 'pending',
      activeForm: parsed.data.activeForm,
    });
    changed(ctx);
    return Promise.resolve(ok(`Created ${id}`));
  },
};

const updateSchema = z.object({
  taskId: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed']).optional(),
  content: z.string().optional(),
  activeForm: z.string().optional(),
});

export const taskUpdateTool: ToolDefinition = {
  name: 'TaskUpdate',
  description:
    'Update an existing task by id (status, content, or activeForm).',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string' },
      status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
      content: { type: 'string' },
      activeForm: { type: 'string' },
    },
    required: ['taskId'],
  },
  handler(input, ctx): Promise<ToolResult> {
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) {
      return Promise.resolve(
        err(`Invalid input: ${parsed.error.issues[0]?.message}`),
      );
    }
    const existing = ctx.tasks.get(parsed.data.taskId);
    if (!existing) {
      return Promise.resolve(err(`No such task: ${parsed.data.taskId}`));
    }
    ctx.tasks.set(parsed.data.taskId, {
      content: parsed.data.content ?? existing.content,
      status: parsed.data.status ?? existing.status,
      activeForm: parsed.data.activeForm ?? existing.activeForm,
    });
    changed(ctx);
    return Promise.resolve(ok(`Updated ${parsed.data.taskId}`));
  },
};

const getSchema = z.object({ taskId: z.string() });

export const taskGetTool: ToolDefinition = {
  name: 'TaskGet',
  description: 'Fetch a single task by id.',
  inputSchema: {
    type: 'object',
    properties: { taskId: { type: 'string' } },
    required: ['taskId'],
  },
  handler(input, ctx): Promise<ToolResult> {
    const parsed = getSchema.safeParse(input);
    if (!parsed.success) {
      return Promise.resolve(
        err(`Invalid input: ${parsed.error.issues[0]?.message}`),
      );
    }
    const task = ctx.tasks.get(parsed.data.taskId);
    return Promise.resolve(
      task
        ? ok(JSON.stringify({ id: parsed.data.taskId, ...task }))
        : err(`No such task: ${parsed.data.taskId}`),
    );
  },
};

export const taskListTool: ToolDefinition = {
  name: 'TaskList',
  description: 'List all tasks in the shared task list.',
  inputSchema: { type: 'object', properties: {} },
  handler(_input, ctx): Promise<ToolResult> {
    const all = Array.from(ctx.tasks.entries()).map(([id, t]) => ({
      id,
      ...t,
    }));
    return Promise.resolve(ok(JSON.stringify(all)));
  },
};
