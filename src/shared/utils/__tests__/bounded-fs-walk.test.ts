import fs from 'fs';
import { walkProjectFiles, safeReadFile } from '@utils/bounded-fs';
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
});
