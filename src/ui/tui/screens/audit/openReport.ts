import { spawn } from 'node:child_process';

const PLATFORM_OPEN_CMD: Record<NodeJS.Platform, string> = {
  darwin: 'open',
  win32: 'start',
  aix: 'xdg-open',
  android: 'xdg-open',
  freebsd: 'xdg-open',
  haiku: 'xdg-open',
  linux: 'xdg-open',
  openbsd: 'xdg-open',
  sunos: 'xdg-open',
  netbsd: 'xdg-open',
  cygwin: 'xdg-open',
};

/** Best-effort: hand the absolute path to the OS's default opener.
 *  Failures are swallowed — the user can always open the file manually. */
export function openReport(absolutePath: string): void {
  const cmd = PLATFORM_OPEN_CMD[process.platform] ?? 'xdg-open';
  try {
    spawn(cmd, [absolutePath], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // Best-effort.
  }
}
