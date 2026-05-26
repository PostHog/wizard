/**
 * Task-stream push — subscribes to WizardStore, builds payloads,
 * and fans out async to all registered destinations.
 */

import type { WizardStore, TaskItem } from '@ui/tui/store';
import { TaskStatus } from '@ui/wizard-ui';
import { RunPhase } from '@lib/wizard-session';
import {
  type TaskStreamDestination,
  type TaskStreamUpdate,
  type StreamTask,
  StreamTaskStatus,
  StreamEvent,
} from './types';

const STATUS_MAP: Record<TaskStatus, StreamTaskStatus> = {
  [TaskStatus.Pending]: StreamTaskStatus.Pending,
  [TaskStatus.InProgress]: StreamTaskStatus.InProgress,
  [TaskStatus.Completed]: StreamTaskStatus.Completed,
};

function buildTasks(items: TaskItem[]): StreamTask[] {
  return items.map((item, i) => ({
    id: String(i),
    title: item.label,
    status: STATUS_MAP[item.status] ?? StreamTaskStatus.Pending,
  }));
}

export interface TaskStreamPushOptions {
  store: WizardStore;
  programId: string;
  destinations: TaskStreamDestination[];
}

export class TaskStreamPush {
  private readonly store: WizardStore;
  private readonly destinations: TaskStreamDestination[];
  private readonly startedAt: string;
  private readonly programId: string;

  private sessionId: string | null = null;
  private created = false;

  constructor(opts: TaskStreamPushOptions) {
    this.store = opts.store;
    this.programId = opts.programId;
    this.destinations = opts.destinations;
    this.startedAt = new Date().toISOString();
  }

  /** Send a final push. */
  async dispose(): Promise<void> {
    await this.push();
  }

  async push(): Promise<void> {
    const { session, tasks, eventPlan } = this.store;
    const skillId = session.skillId ?? this.programId;

    // Lock session ID on first push so it stays stable
    if (!this.sessionId) {
      this.sessionId = `${this.programId}-${skillId}-${this.startedAt}`;
    }

    const payload: TaskStreamUpdate = {
      session_id: this.sessionId,
      program_id: this.programId,
      skill_id: skillId,
      started_at: this.startedAt,
      run_phase: session.runPhase,
      tasks: buildTasks(tasks),
      event_plan: eventPlan.length > 0 ? eventPlan : undefined,
      timestamp: new Date().toISOString(),
    };

    let event: StreamEvent;
    if (!this.created) {
      this.created = true;
      event = StreamEvent.Create;
    } else if (payload.run_phase === RunPhase.Completed) {
      event = StreamEvent.Complete;
    } else if (payload.run_phase === RunPhase.Error) {
      event = StreamEvent.Error;
    } else {
      event = StreamEvent.Update;
    }

    await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      this.destinations.map((d) => d.send(event, payload).catch(() => {})),
    );
  }
}
