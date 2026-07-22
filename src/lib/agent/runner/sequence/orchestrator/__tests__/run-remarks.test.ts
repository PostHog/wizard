import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QueueStore } from '@lib/agent/runner/sequence/orchestrator/queue';
import { collectRunRemarks } from '@lib/agent/runner/sequence/orchestrator/orchestrator-runner';

const attribute = (task: { type: string }) => ({
  harness: 'pi',
  model: task.type === 'capture' ? 'gpt-5.6-terra' : 'gpt-5.6-luna',
});

describe('collectRunRemarks', () => {
  let dir: string;
  let store: QueueStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-remarks-test-'));
    store = new QueueStore(dir, 'run-1');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function finish(type: string, remark?: string) {
    const task = store.enqueue({ type });
    store.start(task.id);
    store.complete(
      task.id,
      { goals: 'g', did: 'd', forNextAgent: 'n' },
      remark,
    );
    return task;
  }

  it('collects every remarking task, attributed to its step and model', () => {
    finish('install', 'the fence rejected gradlew before I found the wrapper');
    finish('init');
    finish('capture', 'the framework doc showed an API that does not exist');

    expect(collectRunRemarks(store.list(), attribute)).toEqual([
      {
        task_type: 'install',
        status: 'done',
        harness: 'pi',
        model: 'gpt-5.6-luna',
        remark: 'the fence rejected gradlew before I found the wrapper',
      },
      {
        task_type: 'capture',
        status: 'done',
        harness: 'pi',
        model: 'gpt-5.6-terra',
        remark: 'the framework doc showed an API that does not exist',
      },
    ]);
  });

  it('is empty when nothing cost a task turns', () => {
    finish('install');
    finish('init');
    expect(collectRunRemarks(store.list(), attribute)).toEqual([]);
  });

  it('collects from a task that ended not needed or failed', () => {
    const skipped = store.enqueue({ type: 'identify' });
    store.start(skipped.id);
    store.skip(
      skipped.id,
      { goals: 'g', did: 'nothing to do', forNextAgent: 'n' },
      'no auth in this project, the prompt could say so up front',
    );

    const remarks = collectRunRemarks(store.list(), attribute);
    expect(remarks).toHaveLength(1);
    expect(remarks[0].status).toBe('not needed');
  });
});
