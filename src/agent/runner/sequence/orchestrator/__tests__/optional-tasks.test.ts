/** Only required failures and blocked work abort; optional failures never do. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn(), captureException: vi.fn() },
}));

import { QueueStore } from '@agent/runner/sequence/orchestrator/queue';
import {
  deliversRunReport,
  describeDrainFailure,
  drainFailureCode,
  drainVerdict,
  failedTaskConflicts,
  uninstalledPackages,
  uninstalledPackagesNote,
} from '@agent/runner/sequence/orchestrator/orchestrator-runner';
import { ErrorCodes } from '@shared/errors';

describe('drainVerdict', () => {
  let dir: string;
  let store: QueueStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-test-'));
    store = new QueueStore(dir, 'run-1');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const finish = (id: string, ok: boolean) => {
    store.start(id);
    if (ok) store.complete(id);
    else store.fail(id, { type: 'boom', message: 'x' });
  };

  it('a failed optional task does not fail the run', () => {
    const warehouse = store.enqueue({ type: 'warehouse', optional: true });
    const install = store.enqueue({ type: 'install' });
    const report = store.enqueue({
      type: 'report',
      dependsOn: [install.id, warehouse.id],
    });
    finish(warehouse.id, false);
    finish(install.id, true);
    finish(report.id, true);

    const v = drainVerdict(store.list());
    expect(v.requiredFailedTypes).toEqual([]);
    expect(v.optionalFailedTypes).toEqual(['warehouse']);
    expect(v.blocked).toBe(0);
  });

  it('a failed required task still fails the run', () => {
    const install = store.enqueue({ type: 'install' });
    store.enqueue({ type: 'report', dependsOn: [install.id] });
    finish(install.id, false);

    const v = drainVerdict(store.list());
    expect(v.requiredFailedTypes).toEqual(['install']);
    expect(v.blocked).toBe(1);
    expect(v.blockedTypes).toEqual(['report']);
  });

  it('a task that failed after it delivered the run report does not fail the run', () => {
    const install = store.enqueue({ type: 'install' });
    const report = store.enqueue({ type: 'report', dependsOn: [install.id] });
    finish(install.id, true);
    finish(report.id, false);

    expect(drainVerdict(store.list()).requiredFailedTypes).toEqual(['report']);
    const v = drainVerdict(store.list(), new Set([report.id]));
    expect(v.requiredFailedTypes).toEqual([]);
    expect(v.deliveredFailedTypes).toEqual(['report']);
    expect(v.optionalFailedTypes).toEqual([]);
  });

  it('only the sink task delivers the run report', () => {
    const handoff = { kind: 'handoff', text: '# Report' } as const;
    expect(deliversRunReport(['report'], 'report', handoff)).toBe(true);
    expect(deliversRunReport(['report'], 'init', handoff)).toBe(false);
    expect(
      deliversRunReport(['report'], 'report', { kind: 'status', message: 'x' }),
    ).toBe(false);
  });

  it('names a step the user accepted that never became runnable', () => {
    const install = store.enqueue({ type: 'install' });
    store.enqueue({
      type: 'warehouse',
      optional: true,
      dependsOn: [install.id],
    });
    finish(install.id, false);

    expect(drainVerdict(store.list()).blockedTypes).toEqual(['warehouse']);
  });
});

describe('describeDrainFailure', () => {
  it('names the failure and the steps it stopped', () => {
    expect(
      describeDrainFailure({
        requiredFailedTypes: ['install'],
        blockedTypes: ['warehouse', 'report'],
      }),
    ).toBe('the install step failed, so the warehouse, report steps never ran');
  });

  it('names blocked steps when nothing failed outright', () => {
    expect(
      describeDrainFailure({
        requiredFailedTypes: [],
        blockedTypes: ['warehouse'],
      }),
    ).toBe('the warehouse step never ran');
  });

  it('names the failure alone when nothing was left pending', () => {
    expect(
      describeDrainFailure({
        requiredFailedTypes: ['report'],
        blockedTypes: [],
      }),
    ).toBe('the report step failed');
  });
});

describe('drainFailureCode', () => {
  it('names a drain with a failed required step as failed', () => {
    expect(drainFailureCode({ requiredFailedTypes: ['install'] })).toBe(
      ErrorCodes.AgentOrchestratorTasksFailed,
    );
  });

  it('names a drain where nothing failed but steps never ran as blocked', () => {
    expect(drainFailureCode({ requiredFailedTypes: [] })).toBe(
      ErrorCodes.AgentOrchestratorTasksBlocked,
    );
  });
});

describe('uninstalledPackages', () => {
  let dir: string;
  let store: QueueStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uninstalled-test-'));
    store = new QueueStore(dir, 'run-1');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const handoff = (packages?: string[]) => ({
    goals: 'g',
    did: 'd',
    forNextAgent: 'n',
    ...(packages && { packages }),
  });
  const uninstalled = () =>
    uninstalledPackages(store.list(), (id) => store.readHandoff(id));

  /** Two finished tasks that left packages for review, and a review task. */
  function queueWithReview() {
    const mcp = store.enqueue({ type: 'mcp-analytics', optional: true });
    const logs = store.enqueue({ type: 'logs', optional: true });
    const review = store.enqueue({
      type: 'review',
      dependsOn: [mcp.id, logs.id],
    });
    for (const [task, packages] of [
      [mcp, ['@posthog/mcp (exact)']],
      [logs, ['@opentelemetry/sdk-logs', '@posthog/mcp (exact)']],
    ] as const) {
      store.start(task.id);
      store.complete(task.id, handoff([...packages]));
    }
    return review;
  }

  it('names every package finished tasks left, once, when review did not finish', () => {
    const review = queueWithReview();
    store.start(review.id);
    store.fail(review.id, { type: 'yara', message: 'stopped' });

    expect(uninstalled()).toEqual([
      '@posthog/mcp (exact)',
      '@opentelemetry/sdk-logs',
    ]);
    expect(uninstalledPackagesNote(uninstalled())).toContain(
      'never installed: @posthog/mcp (exact), @opentelemetry/sdk-logs.',
    );
  });

  it('names them when review never started', () => {
    queueWithReview();
    expect(uninstalled()).toHaveLength(2);
  });

  it('names none once review finished, or when the run has no review', () => {
    const review = queueWithReview();
    store.start(review.id);
    store.complete(review.id, handoff());
    expect(uninstalled()).toEqual([]);

    const other = new QueueStore(
      fs.mkdtempSync(path.join(dir, 'no-review-')),
      'run-2',
    );
    const task = other.enqueue({ type: 'logs' });
    other.start(task.id);
    other.complete(task.id, handoff(['@opentelemetry/sdk-logs']));
    expect(
      uninstalledPackages(other.list(), (id) => other.readHandoff(id)),
    ).toEqual([]);
  });
});

describe('failedTaskConflicts', () => {
  let dir: string;
  let store: QueueStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conflicts-test-'));
    store = new QueueStore(dir, 'run-1');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const failWith = (type: string, optional: boolean, conflict?: string) => {
    const task = store.enqueue({ type, optional });
    store.start(task.id);
    store.fail(
      task.id,
      { type: 'self-reported', message: 'x' },
      { goals: 'g', did: 'd', forNextAgent: 'n', conflict },
    );
  };

  it('returns each required failed task reason once, and no optional ones', () => {
    const wrongFramework = 'This project is TypeScript, not Python.';
    failWith('init', false, wrongFramework);
    failWith('install', false, wrongFramework);
    failWith('logs', true, 'An optional task reason.');
    failWith('capture', false);

    expect(
      failedTaskConflicts(store.list(), (id) => store.readHandoff(id)),
    ).toEqual([wrongFramework]);
  });
});
