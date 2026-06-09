/**
 * Inline prompts for the walking skeleton. They prove the seed -> drain pipeline
 * without touching the user's project: the seed agent plans a task graph, and each
 * task is a dry-run stub that only reports a handoff. The real agent prompts live
 * in context-mill as the `agents` content type and replace these later.
 */
import type { QueuedTask } from './queue';

/** Task types the skeleton seeds. Mirrors the real integration graph. */
export const SKELETON_TASK_TYPES = [
  'install',
  'init',
  'identify',
  'plan-capture',
  'capture',
] as const;

export function buildSeedPrompt(): string {
  return `You are the orchestrator for a PostHog integration. Right now your only job is to plan the work and seed a task queue. Do NOT install anything, edit any files, or integrate PostHog yourself.

Take a quick look at the repository to confirm it is a real project. A brief glance, not a deep analysis.

Then seed the queue by calling enqueue_task five times. Each call returns a JSON object with an "id". Capture those ids so you can wire dependencies:

1. enqueue_task, type "install", no dependsOn.
2. enqueue_task, type "init", no dependsOn. install and init are independent and can run together.
3. enqueue_task, type "identify", dependsOn = [the install id, the init id].
4. enqueue_task, type "plan-capture", dependsOn = [the install id, the init id]. identify and plan-capture are independent of each other.
5. enqueue_task, type "capture", dependsOn = [the plan-capture id].

After all five are enqueued, you are done. Do NOT call complete_task. You are the orchestrator, not a task.`;
}

export function buildStubPrompt(task: QueuedTask): string {
  return `You are a single, isolated task of type "${task.type}" in a PostHog integration. This is a DRY RUN: do not install anything, edit any files, or change the user's project in any way.

Your only job is to report completion. Call complete_task exactly once with:
- status: "done"
- handoff:
  - goals: one line on what a real "${task.type}" task would aim to do
  - did: a one-line note that this was a dry-run stub, no changes made
  - forNextAgent: anything the next task should know

Then stop.`;
}
