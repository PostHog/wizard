import { spawn } from 'child_process';

/**
 * Open a URL in the user's default browser, detached so it doesn't block the
 * wizard process. Best-effort: failures (e.g. headless environments) are
 * swallowed — callers should always show the URL as text too.
 */
export function openUrl(url: string): void {
  const cmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // Ignore — the URL is always shown as text as a fallback.
  }
}
