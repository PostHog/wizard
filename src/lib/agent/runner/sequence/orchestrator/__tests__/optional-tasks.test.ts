/**
 * The optional-task verdict: a runner-seeded task's failure is reported, never
 * inherited by the run. Only required failures and blocked work abort.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn(), captureException: vi.fn() },
}));

import { QueueStore } from '@lib/agent/runner/sequence/orchestrator/queue';
import { drainVerdict } from '@lib/agent/runner/sequence/orchestrator/orchestrator-runner';

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
  });
});
