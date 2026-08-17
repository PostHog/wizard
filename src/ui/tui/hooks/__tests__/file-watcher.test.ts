import { mkdtempSync, rmSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  startFileWatcher,
  type FileWatcherHandle,
} from '@ui/tui/hooks/file-watcher';
import { logToFile } from '@utils/debug';

vi.mock('@utils/debug', () => ({
  logToFile: vi.fn(),
}));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('startFileWatcher', () => {
  let workdir: string;
  let handle: FileWatcherHandle | undefined;

  beforeEach(() => {
    workdir = mkdtempSync(path.join(tmpdir(), 'wizard-fw-'));
    vi.mocked(logToFile).mockClear();
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

  it('swallows invalid JSON without throwing', async () => {
    const onUpdate = vi.fn();
    const target = path.join(workdir, 'data.json');
    writeFileSync(target, '{not valid');

    handle = startFileWatcher(target, onUpdate, { pollIntervalMs: 30 });

    await wait(100);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(logToFile).toHaveBeenCalledWith(
      expect.stringContaining('could not read valid JSON'),
    );
  });

  it('allows an initial update callback to stop its watcher', async () => {
    const target = path.join(workdir, 'data.json');
    writeFileSync(target, JSON.stringify({ a: 1 }));
    const onUpdate = vi.fn(() => handle?.stop());

    handle = startFileWatcher(target, onUpdate, { pollIntervalMs: 30 });
    await wait(20);
    writeFileSync(target, JSON.stringify({ a: 2 }));
    await wait(100);

    expect(onUpdate).toHaveBeenCalledTimes(1);
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

  it('refreshes synchronously before shutdown', () => {
    const onUpdate = vi.fn();
    const target = path.join(workdir, 'data.json');
    handle = startFileWatcher(target, onUpdate, { pollIntervalMs: 10_000 });
    writeFileSync(target, JSON.stringify({ final: true }));

    handle.refresh();

    expect(onUpdate).toHaveBeenCalledWith({ final: true });
  });

  it('ignores a pre-existing file until it changes', () => {
    const onUpdate = vi.fn();
    const target = path.join(workdir, 'data.json');
    writeFileSync(target, JSON.stringify({ stale: true }));
    handle = startFileWatcher(target, onUpdate, {
      ignoreInitialFile: true,
    });

    handle.refresh();
    expect(onUpdate).not.toHaveBeenCalled();

    writeFileSync(target, JSON.stringify({ current: true }));
    handle.refresh();
    expect(onUpdate).toHaveBeenCalledWith({ current: true });
  });

  it('enforces file-size bounds', () => {
    const onUpdate = vi.fn();
    const target = path.join(workdir, 'data.json');

    writeFileSync(target, JSON.stringify({ oversized: 'x'.repeat(100) }));
    handle = startFileWatcher(target, onUpdate, { maxFileSizeBytes: 20 });
    handle.refresh();

    expect(onUpdate).not.toHaveBeenCalled();
    expect(logToFile).toHaveBeenCalledWith(
      expect.stringContaining('refusing oversized JSON file'),
    );
  });
});
