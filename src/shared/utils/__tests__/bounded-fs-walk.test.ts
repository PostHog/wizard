import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  MAX_DIR_ENTRIES,
  walkProjectFiles,
  safeReadFile,
} from '@utils/bounded-fs';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';

vi.mock('../analytics', () => ({
  analytics: { captureException: vi.fn() },
}));
vi.mock('../debug', () => ({ logToFile: vi.fn() }));

const captureException = analytics.captureException as ReturnType<typeof vi.fn>;
const mockLogToFile = logToFile as ReturnType<typeof vi.fn>;

function errnoError(code: string): NodeJS.ErrnoException {
  const err = new Error(`${code}: mock`) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

describe('reportFsError (via walkProjectFiles / safeReadFile)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // Benign codes are expected while scanning arbitrary trees (protected dirs,
  // races, symlink loops) — they must be logged, not captured as exceptions.
  it.each(['EACCES', 'EPERM', 'ENOENT', 'ENOTDIR', 'ELOOP', 'EMFILE'])(
    'does not capture an exception for benign fs error %s',
    (code) => {
      vi.spyOn(fs, 'realpathSync').mockImplementation(() => {
        throw errnoError(code);
      });

      walkProjectFiles('/some/dir', vi.fn());

      expect(captureException).not.toHaveBeenCalled();
      expect(mockLogToFile).toHaveBeenCalledTimes(1);
    },
  );

  it('captures an exception for an unexpected fs error code', () => {
    vi.spyOn(fs, 'realpathSync').mockImplementation(() => {
      throw errnoError('EUNEXPECTED');
    });

    walkProjectFiles('/some/dir', vi.fn());

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(mockLogToFile).not.toHaveBeenCalled();
  });

  it('captures an exception for an error with no errno code', () => {
    vi.spyOn(fs, 'realpathSync').mockImplementation(() => {
      throw new Error('boom');
    });

    walkProjectFiles('/some/dir', vi.fn());

    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('safeReadFile swallows benign read errors without capturing', () => {
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw errnoError('EACCES');
    });

    expect(safeReadFile('/some/file')).toBeNull();
    expect(captureException).not.toHaveBeenCalled();
    expect(mockLogToFile).toHaveBeenCalledTimes(1);
  });

  it.each(['UNKNOWN', 'EBUSY'])(
    'safeReadFile does not capture Windows read error %s',
    (code) => {
      vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1 } as fs.Stats);
      vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw errnoError(code);
      });

      expect(safeReadFile('/some/.env')).toBeNull();
      expect(captureException).not.toHaveBeenCalled();
      expect(mockLogToFile).toHaveBeenCalledTimes(1);
    },
  );
});

describe('walkProjectFiles', () => {
  let root: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bounded-fs-walk-'));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'index.ts'), '');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reports a walk that saw the whole tree as complete', () => {
    expect(walkProjectFiles(root, vi.fn())).toBe(true);
  });

  it('reports a walk that skipped a directory it could not open as partial', () => {
    const opendirSync = fs.opendirSync;
    vi.spyOn(fs, 'opendirSync').mockImplementation((dir, options) => {
      if (dir === path.join(root, 'src')) throw errnoError('EACCES');
      return opendirSync(dir, options);
    });

    expect(walkProjectFiles(root, vi.fn())).toBe(false);
  });

  it('reports a walk that stopped at the per-directory cap as partial', () => {
    let remaining = MAX_DIR_ENTRIES + 1;
    const file = {
      name: 'file.ts',
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    vi.spyOn(fs, 'opendirSync').mockReturnValue({
      readSync: () => (remaining-- > 0 ? file : null),
      closeSync: () => undefined,
    } as unknown as fs.Dir);

    expect(walkProjectFiles(root, vi.fn())).toBe(false);
  });

  it.each([
    [{}, ['index.ts', 'linked.ts']],
    [{ followSymlinks: false }, ['index.ts']],
  ])('with options %j reads %j', (options, expected) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'bounded-fs-out-'));
    try {
      fs.writeFileSync(path.join(outside, 'linked.ts'), '');
      fs.symlinkSync(outside, path.join(root, 'src', 'linked'), 'dir');
      const seen: string[] = [];

      walkProjectFiles(root, (name) => seen.push(name), 3, options);

      expect(seen.sort()).toEqual(expected);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
