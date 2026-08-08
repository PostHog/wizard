import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import type * as fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { startFileWatcher, type FileWatcherHandle } from '@lib/file-watcher';
import { logToFile } from '@utils/debug';

vi.mock('@utils/debug', () => ({
  logToFile: vi.fn(),
}));

// Wrap the real `fs`, capturing every FSWatcher `fs.watch` hands back so the
// test can drive a runtime watcher error. ESM export namespaces are not
// spyable, so the whole module is mocked and delegates to the real impl.
const { createdWatchers } = vi.hoisted(() => ({
  createdWatchers: [] as fs.FSWatcher[],
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs');
  return {
    ...actual,
    watch: (...args: Parameters<typeof actual.watch>): fs.FSWatcher => {
      const watcher = actual.watch(...args);
      createdWatchers.push(watcher);
      return watcher;
    },
  };
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('startFileWatcher error handling', () => {
  let workdir: string;
  let handle: FileWatcherHandle | undefined;

  beforeEach(() => {
    workdir = mkdtempSync(path.join(tmpdir(), 'wizard-fw-err-'));
    vi.mocked(logToFile).mockClear();
    createdWatchers.length = 0;
  });

  afterEach(() => {
    handle?.stop();
    handle = undefined;
    rmSync(workdir, { recursive: true, force: true });
  });

  it('survives a runtime watcher error and keeps polling', async () => {
    const onUpdate = vi.fn();
    const target = path.join(workdir, 'data.json');

    handle = startFileWatcher(target, onUpdate, {
      pollIntervalMs: 50,
      attachRetryIntervalMs: 25,
    });

    expect(createdWatchers).toHaveLength(1);

    // Simulate the EMFILE-class runtime error Node emits through the
    // FSWatcher. Without an 'error' listener this would be an uncaught
    // exception that crashes the wizard TUI.
    expect(() =>
      createdWatchers[0].emit(
        'error',
        new Error('EMFILE: too many open files'),
      ),
    ).not.toThrow();

    expect(logToFile).toHaveBeenCalled();

    // Polling still delivers updates after the watcher has errored.
    writeFileSync(target, JSON.stringify({ a: 1 }));
    await wait(150);

    expect(onUpdate).toHaveBeenCalledWith({ a: 1 });
  });
});
