import { TaskStreamPush } from '../task-stream-push';
import { StreamEvent } from '../types';
import type { TaskStreamDestination, TaskStreamUpdate } from '../types';
import type { WizardStore, TaskItem } from '../../../ui/tui/store';
import { RunPhase } from '../../wizard-session';

// Mocks and stuff

type Listener = () => void;

function createMockStore(overrides: Partial<MockStoreState> = {}) {
  const listeners: Listener[] = [];
  const state: MockStoreState = {
    runPhase: RunPhase.Idle,
    tasks: [],
    eventPlan: [],
    ...overrides,
  };

  const store = {
    get session() {
      return { runPhase: state.runPhase };
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
    // mock setter and getter
    _emit() {
      for (const cb of listeners) cb();
    },
    _set(patch: Partial<MockStoreState>) {
      Object.assign(state, patch);
    },
    _listenerCount() {
      return listeners.length;
    },
  };

  return store as typeof store & WizardStore;
}

interface MockStoreState {
  runPhase: RunPhase;
  tasks: TaskItem[];
  eventPlan: unknown[];
}

function createMockDestination(
  name = 'test',
): TaskStreamDestination & { calls: Array<[StreamEvent, TaskStreamUpdate]> } {
  const calls: Array<[StreamEvent, TaskStreamUpdate]> = [];
  return {
    name,
    calls,
    send: jest.fn((event: StreamEvent, payload: TaskStreamUpdate) => {
      calls.push([event, payload]);
      return Promise.resolve();
    }),
  };
}

function createPush(
  store: ReturnType<typeof createMockStore>,
  dest?: ReturnType<typeof createMockDestination>,
) {
  const d = dest ?? createMockDestination();
  const push = new TaskStreamPush({
    store,
    workflowId: 'test-workflow',
    skillId: 'test-skill',
    destinations: [d],
  });
  return { push, dest: d };
}

describe('TaskStreamPush', () => {
  describe('Coorect order of events', () => {
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

      await push.push(); // CREATE
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

      await push.push(); // CREATE
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
      expect(payload.workflow_id).toBe('test-workflow');
      expect(payload.skill_id).toBe('test-skill');
      expect(payload.session_id).toContain('test-workflow-test-skill-');
    });

    it('includes eventPlan when non-empty', async () => {
      const plan = [{ name: 'signup', description: 'User signs up' }];
      const store = createMockStore({ eventPlan: plan });
      const { push, dest } = createPush(store);

      await push.push();

      expect(dest.calls[0][1].event_plan).toEqual(plan);
    });

    it('omits eventPlan when empty', async () => {
      const store = createMockStore({ eventPlan: [] });
      const { push, dest } = createPush(store);

      await push.push();

      expect(dest.calls[0][1].event_plan).toBeUndefined();
    });
  });

  describe('destinations are independent', () => {
    it('one destination failing does not break others', async () => {
      const store = createMockStore();
      const good = createMockDestination('good');
      const bad: TaskStreamDestination = {
        name: 'bad',
        send: jest.fn(() => {
          return Promise.reject(new Error('network down'));
        }),
      };
      const push = new TaskStreamPush({
        store,
        workflowId: 'w',
        skillId: 's',
        destinations: [bad, good],
      });

      // This should still happily complete and not block the wizard
      await push.push();

      expect(bad.send).toHaveBeenCalledTimes(1);
      expect(good.calls).toHaveLength(1);
    });

    it('push resolves even when all destinations fail', async () => {
      const store = createMockStore();
      const bad: TaskStreamDestination = {
        name: 'bad',
        send: jest.fn(() => {
          return Promise.reject(new Error('fail'));
        }),
      };
      const push = new TaskStreamPush({
        store,
        workflowId: 'w',
        skillId: 's',
        destinations: [bad],
      });

      await expect(push.push()).resolves.toBeUndefined();
    });
  });

  describe('dispose', () => {
    it('unsubscribes from the store', async () => {
      const store = createMockStore();
      const { push } = createPush(store);

      expect(store._listenerCount()).toBe(1);
      await push.dispose();
      expect(store._listenerCount()).toBe(0);
    });

    it('sends a final push', async () => {
      const store = createMockStore();
      const { push, dest } = createPush(store);

      await push.dispose();

      expect(dest.calls).toHaveLength(1);
    });

    it('no more pushes fire after dispose', async () => {
      const store = createMockStore();
      const { push, dest } = createPush(store);

      await push.dispose(); // sends 1

      store._emit();
      await new Promise((r) => setTimeout(r, 0));

      // Only the dispose push, no onChange push
      expect(dest.calls).toHaveLength(1);
    });
  });
});
