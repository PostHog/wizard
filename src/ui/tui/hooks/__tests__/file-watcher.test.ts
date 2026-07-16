import * as fs from 'fs';
import { mkdtempSync, rmSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  startFileWatcher,
  type FileWatcherHandle,
} from '@ui/tui/hooks/file-watcher';

// Wrap `fs` so we can assert the watcher never reaches for the throwing
// `accessSync` existence probe. All other fs calls pass through untouched.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    accessSync: vi.fn((...args: Parameters<typeof actual.accessSync>) =>
      actual.accessSync(...args),
    ),
  };
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('startFileWatcher', () => {
  let workdir: string;
  let handle: FileWatcherHandle | undefined;

  beforeEach(() => {
    workdir = mkdtempSync(path.join(tmpdir(), 'wizard-fw-'));
  });

  afterEach(() => {
    handle?.stop();
    handle = undefined;
    rmSync(workdir, { recursive: true, force: true });
  });

  it('fires onUpdate when the watched file becomes valid JSON', async () => {
    const onUpdate = vi.fn();
    const target = path.join(workdir, 'data.json');

    handle = startFileWatcher(target, onUpdate, {
      pollIntervalMs: 50,
      attachRetryIntervalMs: 25,
    });

    writeFileSync(target, JSON.stringify({ a: 1 }));
    await wait(150);

    expect(onUpdate).toHaveBeenCalledWith({ a: 1 });
  });

  it('skips re-parsing when mtime is unchanged across polls', async () => {
    const onUpdate = vi.fn();
    const target = path.join(workdir, 'data.json');
    writeFileSync(target, JSON.stringify({ a: 1 }));

    handle = startFileWatcher(target, onUpdate, { pollIntervalMs: 30 });

    await wait(150);
    const callsAfterIdlePolls = onUpdate.mock.calls.length;
    expect(callsAfterIdlePolls).toBeGreaterThanOrEqual(1);

    await wait(100);
    expect(onUpdate.mock.calls).toHaveLength(callsAfterIdlePolls);
  });

  it('handles atomic-rename writes (write to .tmp + rename)', async () => {
    const onUpdate = vi.fn();
    const target = path.join(workdir, 'data.json');
    writeFileSync(target, JSON.stringify({ v: 1 }));

    handle = startFileWatcher(target, onUpdate, { pollIntervalMs: 30 });

    await wait(50);
    onUpdate.mockClear();

    const tmp = path.join(workdir, 'data.json.tmp');
    writeFileSync(tmp, JSON.stringify({ v: 2 }));
    renameSync(tmp, target);

    await wait(150);
    expect(onUpdate.mock.calls.at(-1)?.[0]).toEqual({ v: 2 });
  });

  it('polls and attaches once the file appears later', async () => {
    const onUpdate = vi.fn();
    const target = path.join(workdir, 'late.json');

    handle = startFileWatcher(target, onUpdate, {
      pollIntervalMs: 30,
      attachRetryIntervalMs: 30,
    });

    await wait(100);
    expect(onUpdate).not.toHaveBeenCalled();

    writeFileSync(target, JSON.stringify({ ready: true }));
    await wait(150);

    expect(onUpdate.mock.calls.at(-1)?.[0]).toEqual({ ready: true });
  });

  it('never probes for the missing file with a throwing accessSync', async () => {
    // Regression: the attach-retry loop used to poll with `fs.accessSync`,
    // which throws ENOENT every tick while the file is absent. With exception
    // autocapture on, each throw was reported as a spurious `$exception`.
    const accessSync = vi.mocked(fs.accessSync);
    accessSync.mockClear();
    const onUpdate = vi.fn();
    const target = path.join(workdir, 'never.json');

    handle = startFileWatcher(target, onUpdate, {
      pollIntervalMs: 20,
      attachRetryIntervalMs: 20,
    });

    // Several retry ticks elapse with the file still absent.
    await wait(120);

    expect(accessSync).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('swallows invalid JSON without throwing', async () => {
    const onUpdate = vi.fn();
    const target = path.join(workdir, 'data.json');
    writeFileSync(target, '{not valid');

    handle = startFileWatcher(target, onUpdate, { pollIntervalMs: 30 });

    await wait(100);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('stop() halts polling and watchers', async () => {
    const onUpdate = vi.fn();
    const target = path.join(workdir, 'data.json');
    writeFileSync(target, JSON.stringify({ a: 1 }));

    handle = startFileWatcher(target, onUpdate, { pollIntervalMs: 30 });
    await wait(50);
    handle.stop();
    onUpdate.mockClear();

    writeFileSync(target, JSON.stringify({ a: 2 }));
    await wait(150);

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('survives the file being deleted and recreated', async () => {
    const onUpdate = vi.fn();
    const target = path.join(workdir, 'data.json');
    writeFileSync(target, JSON.stringify({ v: 1 }));

    handle = startFileWatcher(target, onUpdate, { pollIntervalMs: 30 });

    await wait(50);
    onUpdate.mockClear();

    unlinkSync(target);
    await wait(80);
    writeFileSync(target, JSON.stringify({ v: 2 }));

    await wait(150);
    expect(onUpdate.mock.calls.at(-1)?.[0]).toEqual({ v: 2 });
  });
});
