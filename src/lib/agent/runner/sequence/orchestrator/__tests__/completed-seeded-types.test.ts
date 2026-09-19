/**
 * Which seeded types the orchestrated outro reports as done.
 *
 * The outro's next-step bullets are what the user is left with when a seeded
 * step did not carry out its work, so every terminal state other than `done`
 * has to keep them — a declined step is the case they exist for.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn(), captureException: vi.fn() },
}));

import {
  QueueStore,
  SkipReason,
} from '@lib/agent/runner/sequence/orchestrator/queue';
import { completedSeededTypes } from '@lib/agent/runner/sequence/orchestrator/orchestrator-runner';

describe('completedSeededTypes', () => {
  let dir: string;
  let store: QueueStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seeded-outcome-test-'));
    store = new QueueStore(dir, 'run-1');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('names a seeded type that completed', () => {
    const warehouse = store.enqueue({ type: 'warehouse', optional: true });
    store.start(warehouse.id);
    store.complete(warehouse.id);

    expect(completedSeededTypes(store, [warehouse])).toEqual(['warehouse']);
  });

  it('leaves out a declined seeded type', () => {
    const warehouse = store.enqueue({ type: 'warehouse', optional: true });
    store.skip(warehouse.id, SkipReason.UserDeclined);

    expect(completedSeededTypes(store, [warehouse])).toEqual([]);
  });

  it('leaves out a seeded type the agent reported not needed', () => {
    const warehouse = store.enqueue({ type: 'warehouse', optional: true });
    store.start(warehouse.id);
    store.skip(warehouse.id, SkipReason.AgentNotNeeded);

    expect(completedSeededTypes(store, [warehouse])).toEqual([]);
  });

  it('leaves out a failed seeded type', () => {
    const warehouse = store.enqueue({ type: 'warehouse', optional: true });
    store.start(warehouse.id);
    store.fail(warehouse.id, { type: 'self-reported', message: 'x' });

    expect(completedSeededTypes(store, [warehouse])).toEqual([]);
  });

  it('ignores tasks the wizard did not seed', () => {
    const warehouse = store.enqueue({ type: 'warehouse', optional: true });
    const install = store.enqueue({ type: 'install' });
    store.start(install.id);
    store.complete(install.id);
    store.skip(warehouse.id, SkipReason.UserDeclined);

    expect(completedSeededTypes(store, [warehouse])).toEqual([]);
  });
});
