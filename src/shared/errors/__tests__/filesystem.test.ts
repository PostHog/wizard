import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '../codes';
import {
  classifyFsFailure,
  filesystemRunError,
  FsFailureKind,
} from '../filesystem';

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe('classifyFsFailure', () => {
  it.each([
    ['ENOENT', 'linux', FsFailureKind.Missing],
    ['ENOTDIR', 'linux', FsFailureKind.Missing],
    ['EBUSY', 'linux', FsFailureKind.Locked],
    ['EMFILE', 'darwin', FsFailureKind.Locked],
    ['EPERM', 'win32', FsFailureKind.Locked],
    ['EACCES', 'win32', FsFailureKind.Locked],
    ['EPERM', 'linux', FsFailureKind.Denied],
    ['EACCES', 'darwin', FsFailureKind.Denied],
    ['EROFS', 'win32', FsFailureKind.Denied],
    ['ENOSPC', 'linux', FsFailureKind.NoSpace],
    ['EDQUOT', 'darwin', FsFailureKind.NoSpace],
    ['EIO', 'linux', FsFailureKind.Unknown],
  ] as const)('%s on %s is %s', (code, platform, kind) => {
    expect(classifyFsFailure(errno(code), platform)).toBe(kind);
  });

  it('treats an error without an errno code as unknown', () => {
    expect(classifyFsFailure(new Error('boom'))).toBe(FsFailureKind.Unknown);
    expect(classifyFsFailure(undefined)).toBe(FsFailureKind.Unknown);
  });
});

describe('filesystemRunError', () => {
  it('codes a full disk', () => {
    const error = filesystemRunError(errno('ENOSPC'), '/p/.cache', 'linux');
    expect(error?.code).toBe(ErrorCodes.EnvDiskFull);
    expect(error?.message).toContain('/p/.cache');
    expect(error?.context).toEqual({ reason: 'ENOSPC' });
  });

  it('codes a folder the user cannot write', () => {
    expect(filesystemRunError(errno('EACCES'), '/p', 'linux')?.code).toBe(
      ErrorCodes.EnvFileAccessDenied,
    );
  });

  it('leaves recoverable and unknown failures to the caller', () => {
    expect(filesystemRunError(errno('ENOENT'), '/p', 'linux')).toBeUndefined();
    expect(filesystemRunError(errno('EPERM'), '/p', 'win32')).toBeUndefined();
    expect(filesystemRunError(errno('EIO'), '/p', 'linux')).toBeUndefined();
  });
});
