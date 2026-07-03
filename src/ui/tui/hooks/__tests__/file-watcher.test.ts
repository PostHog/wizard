import * as fs from 'fs';
import { mkdtempSync, rmSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  startFileWatcher,
  type FileWatcherHandle,
} from '@ui/tui/hooks/file-watcher';

// Capture the FSWatcher instances the hook attaches by wrapping the real
// fs.watch. The vitest ESM namespace is frozen (neither vi.spyOn nor direct
// assignment works), so we mock the module and delegate to the actual impl.
const { createdWatchers } = vi.hoisted(() => ({
  createdWatchers: [] as import('fs').FSWatcher[],
}));

vi.mock('fs', async (importActual) => {
  const actual = await importActual<typeof import('fs')>();
  const watch: typeof actual.watch = (
    ...args: Parameters<typeof actual.watch>
  ) => {
    const watcher = (actual.watch as (...a: unknown[]) => fs.FSWatcher)(
      ...args,
    );
    createdWatchers.push(watcher);
    return watcher;
  };
  return { ...actual, default: actual, watch };
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('startFileWatcher', () => {
  let workdir: string;
  let handle: FileWatcherHandle | undefined;

  beforeEach(() => {
    workdir = mkdtempSync(path.join(tmpdir(), 'wizard-fw-'));
    createdWatchers.length = 0;
  });

  afterEach(async () => {
    // Stop the watcher before deleting its directory, then yield once so any
    // already-scheduled timer/watch callbacks drain against the still-present
    // path rather than a vanished one.
    handle?.stop();
    handle = undefined;
    await wait(0);
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

  it('handles fs.watch error events instead of letting them go unhandled', () => {
    const onUpdate = vi.fn();
    const target = path.join(workdir, 'data.json');
    writeFileSync(target, JSON.stringify({ v: 1 }));

    handle = startFileWatcher(target, onUpdate, { pollIntervalMs: 1000 });

    // When the watched path's directory is removed, Node emits an 'error'
    // event on the FSWatcher; on an emitter with no 'error' listener that is
    // re-thrown as an uncaught exception — the reported crash. The hook must
    // register a listener so this is swallowed.
    const watcher = createdWatchers[0];
    expect(watcher).toBeDefined();

    const enoent = Object.assign(new Error('ENOENT: watched path removed'), {
      code: 'ENOENT',
    });
    expect(() => watcher.emit('error', enoent)).not.toThrow();
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
