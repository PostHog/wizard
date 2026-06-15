import { TaskStreamPush } from '@lib/task-stream/task-stream-push';
import { StreamEvent } from '@lib/task-stream/types';
import type {
  TaskStreamDestination,
  TaskStreamUpdate,
} from '@lib/task-stream/types';
import type { WizardStore, TaskItem } from '@ui/tui/store';
import { RunPhase } from '@lib/wizard-session';

type Listener = () => void;

interface MockStoreState {
  runPhase: RunPhase;
  skillId: string | null;
  tasks: TaskItem[];
  eventPlan: unknown[];
}

function createMockStore(overrides: Partial<MockStoreState> = {}) {
  const listeners: Listener[] = [];
  const state: MockStoreState = {
    runPhase: RunPhase.Idle,
    skillId: 'test-skill',
    tasks: [],
    eventPlan: [],
    ...overrides,
  };

  const store = {
    get session() {
      return {
        runPhase: state.runPhase,
        skillId: state.skillId,
        outroData: null,
      };
    },
    get tasks() {
      return state.tasks;
    },
    get eventPlan() {
      return state.eventPlan;
    },
    subscribe(cb: Listener) {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    _emit() {
      for (const cb of listeners) cb();
    },
    _set(patch: Partial<MockStoreState>) {
      Object.assign(state, patch);
    },
    _setAndEmit(patch: Partial<MockStoreState>) {
      Object.assign(state, patch);
      for (const cb of listeners) cb();
    },
    _listenerCount() {
      return listeners.length;
    },
  };

  return store as typeof store & WizardStore;
}

function createMockDestination(name = 'test'): TaskStreamDestination & {
  calls: Array<[StreamEvent, TaskStreamUpdate]>;
} {
  const calls: Array<[StreamEvent, TaskStreamUpdate]> = [];
  return {
    name,
    calls,
    send: vi.fn((event: StreamEvent, payload: TaskStreamUpdate) => {
      calls.push([event, payload]);
      return Promise.resolve();
    }),
  };
}

function createPush(
  store: ReturnType<typeof createMockStore>,
  opts: {
    dest?: ReturnType<typeof createMockDestination>;
    enabled?: boolean;
  } = {},
) {
  const dest = opts.dest ?? createMockDestination();
  const push = new TaskStreamPush({
    store,
    programId: 'test-program',
    destinations: [dest],
    enabled: opts.enabled,
  });
  return { push, dest };
}

describe('TaskStreamPush', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Existing event-sequencing behaviour ────────────────────────

  describe('event ordering (imperative push)', () => {
    it('first push sends CREATE', async () => {
      const store = createMockStore();
      const { push, dest } = createPush(store);

      await push.push();

      expect(dest.calls).toHaveLength(1);
      expect(dest.calls[0][0]).toBe(StreamEvent.Create);
    });

    it('subsequent pushes send UPDATE', async () => {
      const store = createMockStore();
      const { push, dest } = createPush(store);

      await push.push();
      await push.push();
      await push.push();

      expect(dest.calls.map(([ev]) => ev)).toEqual([
        StreamEvent.Create,
        StreamEvent.Update,
        StreamEvent.Update,
      ]);
    });

    it('sends COMPLETE when runPhase is completed', async () => {
      const store = createMockStore();
      const { push, dest } = createPush(store);

      await push.push();
      store._set({ runPhase: RunPhase.Completed });
      await push.push();

      expect(dest.calls.map(([ev]) => ev)).toEqual([
        StreamEvent.Create,
        StreamEvent.Complete,
      ]);
    });

    it('sends ERROR when runPhase is error', async () => {
      const store = createMockStore();
      const { push, dest } = createPush(store);

      await push.push();
      store._set({ runPhase: RunPhase.Error });
      await push.push();

      expect(dest.calls[1][0]).toBe(StreamEvent.Error);
    });

    it('first push with terminal phase sends CREATE then COMPLETE on next', async () => {
      const store = createMockStore({ runPhase: RunPhase.Completed });
      const { push, dest } = createPush(store);

      await push.push();
      await push.push();

      expect(dest.calls.map(([ev]) => ev)).toEqual([
        StreamEvent.Create,
        StreamEvent.Complete,
      ]);
    });
  });

  describe('payload contents', () => {
    it('session_id is correctly formed', async () => {
      const store = createMockStore();
      const { push, dest } = createPush(store);

      await push.push();

      const payload = dest.calls[0][1];
      expect(payload.workflow_id).toBe('test-program');
      expect(payload.skill_id).toBe('test-skill');
      expect(payload.session_id).toMatch(
        /^test-program-test-skill-\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
      );
    });

    it('wraps eventPlan in { events: [...] } so the backend accepts it as a dict', async () => {
      const plan = [{ name: 'signup', description: 'User signs up' }];
      const store = createMockStore({ eventPlan: plan });
      const { push, dest } = createPush(store);

      await push.push();

      expect(dest.calls[0][1].event_plan).toEqual({ events: plan });
    });

    it('omits eventPlan when empty', async () => {
      const store = createMockStore({ eventPlan: [] });
      const { push, dest } = createPush(store);

      await push.push();

      expect(dest.calls[0][1].event_plan).toBeUndefined();
    });

    it('sanitizes workflow_id and skill_id to channel-safe chars', async () => {
      // Backend rejects anything outside ^[A-Za-z0-9_.-]{1,255}$ on
      // workflow_id / skill_id because they appear unescaped in Redis
      // channel names. Sanitize disallowed chars to "-" before sending.
      const store = createMockStore({ skillId: 'has:colons and spaces' });
      const dest = createMockDestination();
      const push = new TaskStreamPush({
        store,
        programId: 'wf:with*globs',
        destinations: [dest],
      });

      await push.push();

      const payload = dest.calls[0][1];
      expect(payload.workflow_id).toBe('wf-with-globs');
      expect(payload.skill_id).toBe('has-colons-and-spaces');
      expect(payload.workflow_id).toMatch(/^[A-Za-z0-9_.-]+$/);
      expect(payload.skill_id).toMatch(/^[A-Za-z0-9_.-]+$/);
    });

    it('populates error when phase is Error', async () => {
      const store = createMockStore({ runPhase: RunPhase.Error });
      const { push, dest } = createPush(store);

      await push.push();

      expect(dest.calls[0][1].error).toEqual({
        type: 'wizard_error',
        message: expect.any(String),
      });
    });
  });

  describe('destinations are independent', () => {
    it('one destination failing does not break others', async () => {
      const store = createMockStore();
      const good = createMockDestination('good');
      const bad: TaskStreamDestination = {
        name: 'bad',
        send: vi.fn(() => Promise.reject(new Error('network down'))),
      };
      const push = new TaskStreamPush({
        store,
        programId: 'w',
        destinations: [bad, good],
      });

      await push.push();

      expect(bad.send).toHaveBeenCalledTimes(1);
      expect(good.calls).toHaveLength(1);
    });

    it('push resolves even when all destinations fail', async () => {
      const store = createMockStore();
      const bad: TaskStreamDestination = {
        name: 'bad',
        send: vi.fn(() => Promise.reject(new Error('fail'))),
      };
      const push = new TaskStreamPush({
        store,
        programId: 'w',
        destinations: [bad],
      });

      await expect(push.push()).resolves.toBeUndefined();
    });
  });

  // ── Spec §9 — 12 required test cases ───────────────────────────

  describe('spec: deterministic session_id', () => {
    it('session_id is locked at construction with second-precision ISO', async () => {
      const fixedNow = new Date('2026-05-20T17:00:00.123Z');
      vi.useFakeTimers();
      vi.setSystemTime(fixedNow);

      const store = createMockStore();
      const { push, dest } = createPush(store);

      // Even if real time advances before the first push, session_id
      // is fixed.
      vi.setSystemTime(new Date('2026-05-20T17:05:00.999Z'));
      await push.push();
      vi.setSystemTime(new Date('2026-05-20T17:10:00.000Z'));
      await push.push();

      expect(dest.calls[0][1].session_id).toBe(
        'test-program-test-skill-2026-05-20T17:00:00Z',
      );
      expect(dest.calls[1][1].session_id).toBe(dest.calls[0][1].session_id);
      expect(dest.calls[0][1].started_at).toBe('2026-05-20T17:00:00Z');

      vi.useRealTimers();
    });
  });

  describe('spec: enabled=false', () => {
    it('attach is a no-op and no destination ever fires', () => {
      const store = createMockStore({ runPhase: RunPhase.Running });
      const { push, dest } = createPush(store, { enabled: false });

      push.attach();
      store._setAndEmit({ runPhase: RunPhase.Running });
      store._setAndEmit({ tasks: [taskItem('build')] });
      store._setAndEmit({ runPhase: RunPhase.Completed });

      expect(store._listenerCount()).toBe(0);
      expect(dest.calls).toHaveLength(0);
    });

    it('shutdown resolves immediately when disabled', async () => {
      const store = createMockStore({ runPhase: RunPhase.Completed });
      const { push, dest } = createPush(store, { enabled: false });

      await push.shutdown(2000);
      expect(dest.calls).toHaveLength(0);
    });
  });

  describe('spec: idle phase is skipped', () => {
    it('store emit with RunPhase.Idle produces no push', async () => {
      const store = createMockStore({ runPhase: RunPhase.Idle });
      const { push, dest } = createPush(store);
      push.attach();

      store._setAndEmit({ runPhase: RunPhase.Idle });
      store._setAndEmit({ tasks: [taskItem('build')] });

      // Flush any pending microtasks.
      await flushMicrotasks();
      expect(dest.calls).toHaveLength(0);
    });
  });

  describe('spec: debounces task updates', () => {
    it('five rapid emits in the running phase produce one HTTP call with the latest task list', async () => {
      vi.useFakeTimers();
      const store = createMockStore({ runPhase: RunPhase.Running });
      const { push, dest } = createPush(store);
      push.attach();

      // First emit fires immediately (phase transition Idle → Running).
      store._setAndEmit({ runPhase: RunPhase.Running });
      await flushMicrotasks();
      expect(dest.calls).toHaveLength(1);
      expect(dest.calls[0][0]).toBe(StreamEvent.Create);

      // Five rapid task emits within 100ms — none fire synchronously.
      for (let i = 1; i <= 5; i++) {
        store._setAndEmit({ tasks: tasksUpTo(i) });
        await vi.advanceTimersByTimeAsync(20);
      }
      expect(dest.calls).toHaveLength(1);

      // Advance past the 250ms debounce window — one push with the latest list.
      await vi.advanceTimersByTimeAsync(250);
      await flushMicrotasks();

      expect(dest.calls).toHaveLength(2);
      expect(dest.calls[1][1].tasks).toHaveLength(5);
    });
  });

  describe('spec: phase change bypasses debounce', () => {
    it('Running → Completed produces an immediate push', async () => {
      vi.useFakeTimers();
      const store = createMockStore({ runPhase: RunPhase.Running });
      const { push, dest } = createPush(store);
      push.attach();

      store._setAndEmit({ runPhase: RunPhase.Running });
      await flushMicrotasks();
      expect(dest.calls).toHaveLength(1);

      // Queue a debounced task update.
      store._setAndEmit({ tasks: [taskItem('build')] });
      await flushMicrotasks();
      expect(dest.calls).toHaveLength(1);

      // Phase change bypasses debounce — immediate push.
      store._setAndEmit({ runPhase: RunPhase.Completed });
      await flushMicrotasks();
      expect(dest.calls).toHaveLength(2);
      expect(dest.calls[1][0]).toBe(StreamEvent.Complete);
    });
  });

  describe('spec: coalesces concurrent emits during in-flight push', () => {
    it('emits during a slow flush produce one follow-up push with the latest state', async () => {
      const store = createMockStore({ runPhase: RunPhase.Running });

      let resolveFirst!: () => void;
      const dest: TaskStreamDestination & {
        calls: Array<[StreamEvent, TaskStreamUpdate]>;
      } = {
        name: 'slow',
        calls: [],
        send: vi.fn((event: StreamEvent, payload: TaskStreamUpdate) => {
          dest.calls.push([event, payload]);
          if (dest.calls.length === 1) {
            return new Promise<void>((resolve) => {
              resolveFirst = resolve;
            });
          }
          return Promise.resolve();
        }),
      };

      const push = new TaskStreamPush({
        store,
        programId: 'w',
        destinations: [dest],
      });
      push.attach();

      // Push A — phase transition fires immediately, hangs unresolved.
      store._setAndEmit({ runPhase: RunPhase.Running });
      await flushMicrotasks();
      expect(dest.calls).toHaveLength(1);

      // Three emits arrive while push A is in flight — all coalesce.
      store._setAndEmit({ tasks: tasksUpTo(1) });
      store._setAndEmit({ tasks: tasksUpTo(2) });
      store._setAndEmit({ tasks: tasksUpTo(3) });
      await flushMicrotasks();
      expect(dest.calls).toHaveLength(1);

      resolveFirst();
      await flushMicrotasks();
      await flushMicrotasks();

      expect(dest.calls).toHaveLength(2);
      expect(dest.calls[1][1].tasks).toHaveLength(3);
    });
  });

  describe('spec: shutdown flushes terminal phase', () => {
    it('shutdown awaits one final push when phase is terminal', async () => {
      const store = createMockStore({ runPhase: RunPhase.Completed });
      const { push, dest } = createPush(store);
      push.attach();

      await push.shutdown(2000);
      expect(dest.calls).toHaveLength(1);
      expect(dest.calls[0][0]).toBe(StreamEvent.Create);
      expect(dest.calls[0][1].run_phase).toBe(RunPhase.Completed);
    });

    it('shutdown skips final push when phase is not terminal', async () => {
      const store = createMockStore({ runPhase: RunPhase.Running });
      const { push, dest } = createPush(store);
      push.attach();

      await push.shutdown(2000);
      expect(dest.calls).toHaveLength(0);
    });
  });

  describe('spec: shutdown honours timeout', () => {
    it('shutdown returns even when destination hangs forever', async () => {
      vi.useFakeTimers();
      const store = createMockStore({ runPhase: RunPhase.Completed });
      const hanging: TaskStreamDestination = {
        name: 'hangs',
        send: vi.fn(() => new Promise<void>(() => undefined)),
      };
      const push = new TaskStreamPush({
        store,
        programId: 'w',
        destinations: [hanging],
      });

      const shutdown = push.shutdown(500);
      vi.advanceTimersByTime(500);
      await expect(shutdown).resolves.toBeUndefined();
      vi.useRealTimers();
    });
  });
});

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Yield enough microtask ticks for chained awaits to settle.
 * Avoids setImmediate / setTimeout so it works under fake timers.
 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

function taskItem(label: string): TaskItem {
  return {
    label,
    activeForm: label,
    status: 'pending' as TaskItem['status'],
    done: false,
  };
}

function tasksUpTo(n: number): TaskItem[] {
  return Array.from({ length: n }, (_, i) => taskItem(`task-${i + 1}`));
}
