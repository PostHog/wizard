import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analytics } from '@utils/analytics';
import {
  NotNeededReason,
  QueueStore,
  SkipReason,
} from '@lib/agent/runner/sequence/orchestrator/queue';

vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn() },
}));
import {
  applyComplete,
  applyEnqueue,
  applyReadHandoffs,
  checkEnqueueGuards,
  COMPLETE_SHAPE_KEYS,
  NOT_NEEDED_REASON_ASK,
  type OrchestratorToolsContext,
} from '@lib/agent/runner/sequence/orchestrator/queue-tools';
import { PI_COMPLETE_PARAM_KEYS } from '@lib/agent/runner/harness/pi/orchestrator-tools';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'queue-tools-test-'));
}

const VALID = ['install', 'init', 'capture'];

describe('checkEnqueueGuards', () => {
  let dir: string;
  let store: QueueStore;
  let ctx: OrchestratorToolsContext;

  beforeEach(() => {
    dir = tmpDir();
    store = new QueueStore(dir, 'run-1');
    ctx = { store, validTypes: VALID };
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('rejects an unknown type', () => {
    const r = checkEnqueueGuards(ctx, { type: 'nope', reason: 'x' });
    expect(r).toMatchObject({ ok: false, guard: 'unknown-type' });
  });

  it('rejects an unknown dependency', () => {
    const r = checkEnqueueGuards(ctx, {
      type: 'init',
      dependsOn: ['ghost'],
      reason: 'x',
    });
    expect(r).toMatchObject({ ok: false, guard: 'unknown-dep' });
  });

  it('trips dedup on the same type and inputs', () => {
    store.enqueue({ type: 'install', inputs: { pkg: 'posthog-js' } });
    const r = checkEnqueueGuards(ctx, {
      type: 'install',
      inputs: { pkg: 'posthog-js' },
      reason: 'x',
    });
    expect(r).toMatchObject({ ok: false, guard: 'dedup' });
  });

  it('allows a valid enqueue', () => {
    const r = checkEnqueueGuards(ctx, { type: 'init', reason: 'x' });
    expect(r).toEqual({ ok: true });
  });

  it('rejects an enqueue that pins a non-allow-listed model', () => {
    const r = checkEnqueueGuards(ctx, {
      type: 'init',
      reason: 'x',
      model: 'openai/gpt-5',
    });
    expect(r).toMatchObject({ ok: false, guard: 'invalid-model' });
  });

  it('allows an allow-listed model override and an omitted model', () => {
    expect(
      checkEnqueueGuards(ctx, {
        type: 'init',
        reason: 'x',
        model: 'openai/gpt-5.6-terra',
      }),
    ).toEqual({ ok: true });
    expect(checkEnqueueGuards(ctx, { type: 'capture', reason: 'x' })).toEqual({
      ok: true,
    });
  });

  it('refuses to grow the queue past the runaway cap', () => {
    for (let i = 0; i < 30; i++) {
      store.enqueue({ type: 'capture', inputs: { i } });
    }
    const r = checkEnqueueGuards(ctx, {
      type: 'init',
      inputs: { i: 30 },
      reason: 'x',
    });
    expect(r).toMatchObject({ ok: false, guard: 'queue-full' });
  });
});

describe('apply functions', () => {
  let dir: string;
  let store: QueueStore;
  let ctx: OrchestratorToolsContext;

  beforeEach(() => {
    dir = tmpDir();
    store = new QueueStore(dir, 'run-1');
    ctx = { store, validTypes: VALID };
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('attributes a seed enqueue to the orchestrator', () => {
    const r = applyEnqueue(ctx, { type: 'install', reason: 'seed' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.task.enqueuedBy).toBe('orchestrator');
  });

  it('attributes a follow-up enqueue to the running task', () => {
    const parent = store.enqueue({ type: 'init' });
    ctx.currentTaskId = parent.id;
    const r = applyEnqueue(ctx, { type: 'capture', reason: 'follow-up' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.task.enqueuedBy).toBe(parent.id);
  });

  it('complete_task fails when no task is running', () => {
    const r = applyComplete(ctx, {
      status: 'done',
      handoff: { goals: 'g', did: 'd', forNextAgent: 'n' },
    });
    expect(r.ok).toBe(false);
  });

  it('complete_task marks the running task done and stores the handoff', () => {
    const t = store.enqueue({ type: 'install' });
    ctx.currentTaskId = t.id;
    store.start(t.id);
    const r = applyComplete(ctx, {
      status: 'done',
      handoff: { goals: 'g', did: 'added sdk', forNextAgent: 'env next' },
    });
    expect(r.ok).toBe(true);
    expect(store.get(t.id)?.status).toBe('done');
    expect(store.readHandoff(t.id)?.did).toBe('added sdk');
  });

  it("complete_task status 'not needed' marks the task not needed, satisfying dependents", () => {
    const t = store.enqueue({ type: 'install' });
    const dependent = store.enqueue({ type: 'init', dependsOn: [t.id] });
    ctx.currentTaskId = t.id;
    store.start(t.id);
    const r = applyComplete(ctx, {
      status: 'not needed',
      handoff: { goals: 'g', did: 'nothing to do', forNextAgent: 'n' },
    });
    expect(r.ok).toBe(true);
    expect(store.get(t.id)?.status).toBe('not needed');
    expect(store.nextRunnable().map((task) => task.id)).toContain(dependent.id);
    // An agent deciding a step does not apply is a different fact from a user
    // declining one; the skipped-task event has to be able to tell them apart.
    expect(store.get(t.id)?.skipReason).toBe('agent-not-needed');
  });

  it("keeps the agent's own words out of the skip reason", () => {
    // The handoff is free text an LLM wrote, on a flow that reaches live
    // database and API credentials. It stays in the run's queue.json, where the
    // report reads it, and out of telemetry, which has no redaction pass.
    const t = store.enqueue({ type: 'warehouse' });
    ctx.currentTaskId = t.id;
    store.start(t.id);
    applyComplete(ctx, {
      status: 'not needed',
      handoff: {
        goals: 'g',
        did: 'nothing — postgres://user:hunter2@db.internal was unreachable',
        forNextAgent: 'n',
      },
    });

    expect(store.get(t.id)?.skipReason).toBe('agent-not-needed');
    expect(JSON.stringify(store.get(t.id)?.skipReason)).not.toContain(
      'hunter2',
    );
  });

  it('a remark is captured against its task type, never left in the handoff', () => {
    const t = store.enqueue({ type: 'install' });
    ctx.currentTaskId = t.id;
    store.start(t.id);
    applyComplete(ctx, {
      status: 'done',
      handoff: { goals: 'g', did: 'd', forNextAgent: 'n' },
      remark: 'the docs omitted the peer dependency',
    });
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'orchestrator remark',
      {
        task_type: 'install',
        remark: 'the docs omitted the peer dependency',
      },
    );
    expect(store.readHandoff(t.id)).not.toHaveProperty('remark');
  });

  it('read_handoffs returns a dependency handoff for the running task', () => {
    const dep = store.enqueue({ type: 'install' });
    store.start(dep.id);
    store.complete(dep.id, {
      goals: 'g',
      did: 'installed',
      forNextAgent: 'now init',
    });
    const t = store.enqueue({ type: 'init', dependsOn: [dep.id] });
    ctx.currentTaskId = t.id;

    const handoffs = applyReadHandoffs(ctx, {});
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0].did).toBe('installed');
  });
});

/**
 * `complete_task`'s `notNeededReason`. The handoff carries the agent's prose
 * and this carries the machine-readable outcome, because the handoff on this
 * step reaches live credentials and never reaches telemetry.
 */
describe('complete_task not-needed reasons', () => {
  let dir: string;
  let store: QueueStore;
  let ctx: OrchestratorToolsContext;
  const HANDOFF = { goals: 'g', did: 'd', forNextAgent: 'n' };

  beforeEach(() => {
    dir = tmpDir();
    store = new QueueStore(dir, 'run-1');
    ctx = { store, validTypes: VALID };
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function skipWith(notNeededReason?: unknown) {
    const t = store.enqueue({ type: 'install' });
    store.start(t.id);
    ctx.currentTaskId = t.id;
    applyComplete(ctx, {
      status: 'not needed',
      handoff: HANDOFF,
      notNeededReason,
    } as never);
    return store.get(t.id);
  }

  it.each([
    NotNeededReason.NotApplicable,
    NotNeededReason.UserDeclined,
    NotNeededReason.Blocked,
  ])('forwards %s onto the task', (reason) => {
    const t = skipWith(reason);
    expect(t?.skipReason).toBe(SkipReason.AgentNotNeeded);
    expect(t?.notNeededReason).toBe(reason);
  });

  // The pi harness hands tool arguments over unvalidated, and an agent asked
  // for a reason readily writes a sentence. A sentence about this step can name
  // a database or a key, so it must not become an analytics dimension.
  it('drops a value that is not one of the declared reasons', () => {
    const t = skipWith('the user cancelled the credential prompt');
    expect(t?.skipReason).toBe(SkipReason.AgentNotNeeded);
    expect(t?.notNeededReason).toBeUndefined();
  });

  it('skips as before when the agent declares no reason', () => {
    const t = skipWith(undefined);
    expect(t?.skipReason).toBe(SkipReason.AgentNotNeeded);
    expect(t?.notNeededReason).toBeUndefined();
  });

  it('asks for every reason the type declares', () => {
    for (const reason of Object.values(NotNeededReason)) {
      expect(NOT_NEEDED_REASON_ASK).toContain(reason);
    }
  });

  it('offers the field on both harnesses, and pi is the one that runs', () => {
    expect(PI_COMPLETE_PARAM_KEYS).toContain('notNeededReason');
    expect(PI_COMPLETE_PARAM_KEYS.slice().sort()).toEqual(
      COMPLETE_SHAPE_KEYS.slice().sort(),
    );
  });
});
