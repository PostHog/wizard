/**
 * Task-stream push — subscribes to WizardStore, builds payloads,
 * and fans out async to all registered destinations.
 */

import type { WizardStore, TaskItem } from '../../ui/tui/store';
import { TaskStatus } from '../../ui/wizard-ui';
import { RunPhase } from '../wizard-session';
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
  workflowId: string;
  skillId: string;
  destinations: TaskStreamDestination[];
}

export class TaskStreamPush {
  private readonly store: WizardStore;
  private readonly destinations: TaskStreamDestination[];
  private readonly startedAt: string;
  private readonly sessionId: string;
  private readonly workflowId: string;
  private readonly skillId: string;

  private readonly unsubscribe: () => void;
  private created = false;

  constructor(opts: TaskStreamPushOptions) {
    this.store = opts.store;
    this.workflowId = opts.workflowId;
    this.skillId = opts.skillId;
    this.destinations = opts.destinations;
    this.startedAt = new Date().toISOString();
    this.sessionId = `${this.workflowId}-${this.skillId}-${this.startedAt}`;

    this.unsubscribe = this.store.subscribe(() => this.onChange());
  }

  /** Detach from the store and send a final push. */
  async dispose(): Promise<void> {
    this.unsubscribe();
    await this.push();
  }

  async push(): Promise<void> {
    const { session, tasks, eventPlan } = this.store;

    const payload: TaskStreamUpdate = {
      session_id: this.sessionId,
      workflow_id: this.workflowId,
      skill_id: this.skillId,
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

  private onChange(): void {
    void this.push();
  }
}
