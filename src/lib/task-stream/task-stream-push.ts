/**
 * Task-stream push — subscribes to WizardStore, builds payloads,
 * and fans out async to all registered destinations.
 */

import type { WizardStore, TaskItem } from '../../ui/tui/store';
import {
  type TaskStreamDestination,
  type TaskStreamUpdate,
  type StreamTask,
  StreamTaskStatus,
  StreamEvent,
  TERMINAL_PHASES,
} from './types';

function buildTasks(items: TaskItem[]): StreamTask[] {
  return items.map((item, i) => ({
    id: String(i),
    title: item.label,
    status:
      (item.status as string as StreamTaskStatus) ?? StreamTaskStatus.Pending,
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

  private lastTasks: TaskItem[] = [];
  private lastEventPlan: unknown[] = [];
  private created = false;

  constructor(opts: TaskStreamPushOptions) {
    this.store = opts.store;
    this.workflowId = opts.workflowId;
    this.skillId = opts.skillId;
    this.destinations = opts.destinations;
    this.startedAt = new Date().toISOString();
    this.sessionId = `${this.workflowId}-${this.skillId}-${this.startedAt}`;

    this.store.subscribe(() => this.onChange());
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
    } else if (TERMINAL_PHASES.has(payload.run_phase)) {
      event = StreamEvent.Complete;
    } else {
      event = StreamEvent.Update;
    }

    this.lastTasks = tasks;
    this.lastEventPlan = eventPlan;

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    await Promise.all(
      this.destinations.map((d) => d.send(event, payload).catch(() => {})),
    );
  }

  private onChange(): void {
    const { tasks, eventPlan } = this.store;
    if (tasks === this.lastTasks && eventPlan === this.lastEventPlan) return;
    void this.push();
  }
}
