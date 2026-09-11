/**
 * Declines are applied before the drain, not inside it.
 *
 * The executor marks a task running — firing `orchestrator task started` — and
 * only then hands it to `runTask`. A decline applied on the far side of that
 * reported a start for a task no agent ever ran, so the declines landed on both
 * sides of every rate measured against starts.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('@ui', () => ({
  getUI: () => ({ showTaskNotice: vi.fn(), cancelTaskNotice: vi.fn() }),
}));
vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
  },
}));

import {
  skipDeclinedSeededTasks,
  type SeededConsent,
} from '@lib/agent/runner/sequence/orchestrator/orchestrator-runner';
import {
  QueueStore,
  SkipReason,
  TaskStatus,
  type TransitionEvent,
  type QueuedTask,
} from '@lib/agent/runner/sequence/orchestrator/queue';

const KEPT: SeededConsent = { keep: true, timedOut: false, errored: false };
const DECLINED: SeededConsent = {
  keep: false,
  timedOut: false,
  errored: false,
};
const TIMED_OUT: SeededConsent = {
  keep: false,
  timedOut: true,
  errored: false,
};

const labelFor = (t: { type: string; label?: string }) => t.label ?? t.type;

describe('skipDeclinedSeededTasks', () => {
  let dir: string;
  let store: QueueStore;
  let events: TransitionEvent[];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seeded-decline-'));
    events = [];
    store = new QueueStore(dir, 'run-1', {
      onTransition: (event: TransitionEvent) => events.push(event),
    });
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const seed = (): QueuedTask =>
    store.enqueue({
      type: 'warehouse',
      label: 'Connect your data sources',
      inputs: {},
      dependsOn: [],
      enqueuedBy: 'orchestrator',
    });

  it('skips a declined task without ever starting it', () => {
    const task = seed();

    const skipped = skipDeclinedSeededTasks(
      store,
      new Map([[task.id, DECLINED]]),
      labelFor,
    );

    expect(skipped).toBe(1);
    expect(events).not.toContain('start');
    expect(events.filter((e) => e === 'skip')).toHaveLength(1);
    expect(store.get(task.id)?.status).toBe(TaskStatus.Skipped);
    expect(store.get(task.id)?.skipReason).toBe(SkipReason.UserDeclined);
  });

  it('carries the reason the answer came about', () => {
    const task = seed();

    skipDeclinedSeededTasks(store, new Map([[task.id, TIMED_OUT]]), labelFor);

    expect(store.get(task.id)?.skipReason).toBe(SkipReason.NoticeTimeout);
    // A step nobody answered for is reported as never set up, not as refused.
    expect(store.readHandoff(task.id)?.did).toContain('never accepted');
  });

  it('hands the report the task label and the user-declined wording', () => {
    const task = seed();

    skipDeclinedSeededTasks(store, new Map([[task.id, DECLINED]]), labelFor);

    const handoff = store.readHandoff(task.id);
    expect(handoff?.goals).toBe('Connect your data sources');
    expect(handoff?.forNextAgent).toContain('declined');
  });

  it('leaves an accepted task pending for the drain', () => {
    const task = seed();

    expect(
      skipDeclinedSeededTasks(store, new Map([[task.id, KEPT]]), labelFor),
    ).toBe(0);
    expect(store.get(task.id)?.status).toBe(TaskStatus.Pending);
    expect(events).not.toContain('skip');
  });

  it('ignores an answer whose task is no longer in the queue', () => {
    expect(
      skipDeclinedSeededTasks(store, new Map([['gone', DECLINED]]), labelFor),
    ).toBe(0);
  });
});
