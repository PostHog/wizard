import { ErrorCodes } from './codes';
import { WizardError } from './wizard-error';

/**
 * What a failed filesystem call means for the run, read from its errno code.
 *
 * - `missing`: ENOENT, ENOTDIR. A path the run made is gone, usually deleted
 *   while the run was going.
 * - `locked`: EBUSY, EAGAIN, EMFILE, ENFILE, and on Windows EPERM and EACCES.
 *   Another process holds the file (antivirus, search indexer, sync client) or
 *   the process is out of file handles. It clears on its own.
 * - `denied`: EACCES, EPERM off Windows, EROFS. The user cannot write there.
 * - `no-space`: ENOSPC, EDQUOT. The disk or the user's quota is full.
 * - `unknown`: anything else, left for the caller to rethrow.
 */
export const FsFailureKind = {
  Missing: 'missing',
  Locked: 'locked',
  Denied: 'denied',
  NoSpace: 'no-space',
  Unknown: 'unknown',
} as const;

export type FsFailureKind = (typeof FsFailureKind)[keyof typeof FsFailureKind];

export function classifyFsFailure(
  error: unknown,
  platform: NodeJS.Platform = process.platform,
): FsFailureKind {
  switch ((error as NodeJS.ErrnoException | undefined)?.code) {
    case 'ENOENT':
    case 'ENOTDIR':
      return FsFailureKind.Missing;
    case 'EBUSY':
    case 'EAGAIN':
    case 'EMFILE':
    case 'ENFILE':
      return FsFailureKind.Locked;
    // Windows reports a file another process holds open as EPERM or EACCES.
    case 'EPERM':
    case 'EACCES':
      return platform === 'win32' ? FsFailureKind.Locked : FsFailureKind.Denied;
    case 'EROFS':
      return FsFailureKind.Denied;
    case 'ENOSPC':
    case 'EDQUOT':
      return FsFailureKind.NoSpace;
    default:
      return FsFailureKind.Unknown;
  }
}

/**
 * The coded error that ends a run on a filesystem failure only the user can
 * fix (a full disk, a folder they cannot write), or undefined when the
 * failure is one the caller should recover from or rethrow.
 */
export function filesystemRunError(
  error: unknown,
  target: string,
  platform: NodeJS.Platform = process.platform,
): WizardError | undefined {
  const errno = (error as NodeJS.ErrnoException | undefined)?.code;
  switch (classifyFsFailure(error, platform)) {
    case FsFailureKind.NoSpace:
      return new WizardError(
        `The disk that holds ${target} is full. Free some disk space and run the wizard again.`,
        { reason: errno },
        ErrorCodes.EnvDiskFull,
      );
    case FsFailureKind.Denied:
      return new WizardError(
        `The wizard does not have permission to write to ${target}. Make sure your user owns this folder and it is not read-only, then run the wizard again.`,
        { reason: errno },
        ErrorCodes.EnvFileAccessDenied,
      );
    default:
      return undefined;
  }
}
