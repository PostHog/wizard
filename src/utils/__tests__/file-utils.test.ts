import fs from 'fs';
import os from 'os';
import path from 'path';
import { walkProjectFiles } from '@utils/file-utils';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';

vi.mock('@utils/analytics', () => ({
  analytics: { captureException: vi.fn() },
}));
vi.mock('@utils/debug', () => ({
  logToFile: vi.fn(),
}));

const captureException =
  analytics.captureException as unknown as MockedFunction<
    typeof analytics.captureException
  >;
const mockLogToFile = logToFile as unknown as MockedFunction<typeof logToFile>;

describe('walkProjectFiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-walk-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('visits regular files', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hi');
    const seen: string[] = [];
    walkProjectFiles(tmpDir, (name) => seen.push(name));
    expect(seen).toContain('a.txt');
  });

  it('skips a broken symlink without reporting it as an exception', () => {
    fs.writeFileSync(path.join(tmpDir, 'real.txt'), 'hi');
    // Point a symlink at a target that does not exist → statSync throws ENOENT.
    fs.symlinkSync(
      path.join(tmpDir, 'does-not-exist'),
      path.join(tmpDir, 'broken-link'),
    );

    const seen: string[] = [];
    walkProjectFiles(tmpDir, (name) => seen.push(name));

    // Traversal stays best-effort: the real file is still found.
    expect(seen).toContain('real.txt');
    // The broken link is skipped (not delivered as a file).
    expect(seen).not.toContain('broken-link');
    // And — the whole point — it is NOT reported to error tracking.
    expect(captureException).not.toHaveBeenCalled();
    // It is downgraded to a log line instead.
    expect(mockLogToFile).toHaveBeenCalledWith(
      expect.stringContaining('ENOENT'),
    );
  });

  it('still reports an unexpected readdir failure as an exception', () => {
    // A non-benign error code must still surface in error tracking.
    const realReaddir = fs.readdirSync;
    const spy = vi.spyOn(fs, 'readdirSync').mockImplementation(((
      p: fs.PathLike,
      opts: unknown,
    ) => {
      if (p === tmpDir) {
        const err = new Error('boom') as NodeJS.ErrnoException;
        err.code = 'EIO';
        throw err;
      }
      return realReaddir(p, opts as Parameters<typeof fs.readdirSync>[1]);
    }) as typeof fs.readdirSync);

    walkProjectFiles(tmpDir, () => undefined);

    expect(captureException).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
