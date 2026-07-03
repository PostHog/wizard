/**
 * Best-effort platform shell-outs for making a URL usable in any terminal —
 * no third-party dependency.
 *
 * Two helpers back the `wizard_ask` link overlay, for terminals that can't
 * linkify a wrapped URL (e.g. macOS Terminal.app, which lacks OSC 8 hyperlink
 * support):
 *
 * - `copyToClipboard` — pipe the URL to the platform clipboard binary so the
 *   user can paste it into a browser.
 * - `openInBrowser` — hand the URL to the platform opener so it launches
 *   directly, no copy/paste needed.
 *
 * Both shell out with `spawn` and never a shell, and pass the URL as an argv
 * (clipboard via stdin) — so there's no shell-injection surface. Neither throws:
 * they return false when no command is reachable (CI, headless, or the binary
 * isn't installed).
 */
import { spawn } from 'node:child_process';
import { logToFile } from './debug.js';
import { analytics } from './analytics';

interface ClipboardCommand {
  cmd: string;
  args: string[];
}

/** Platform clipboard commands, in preference order. */
function clipboardCommands(): ClipboardCommand[] {
  if (process.platform === 'darwin') return [{ cmd: 'pbcopy', args: [] }];
  if (process.platform === 'win32') return [{ cmd: 'clip', args: [] }];
  // Linux / BSD: try Wayland first, then the common X11 utilities.
  return [
    { cmd: 'wl-copy', args: [] },
    { cmd: 'xclip', args: ['-selection', 'clipboard'] },
    { cmd: 'xsel', args: ['--clipboard', '--input'] },
  ];
}

function writeWith(
  { cmd, args }: ClipboardCommand,
  text: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args);
      // ENOENT (missing binary) and EPIPE surface as 'error' events.
      child.on('error', () => resolve(false));
      child.stdin.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
      child.stdin.end(text);
    } catch (err) {
      analytics.captureException(
        err instanceof Error ? err : new Error(String(err)),
        { step: 'write_with' },
      );
      resolve(false);
    }
  });
}

export async function copyToClipboard(text: string): Promise<boolean> {
  for (const command of clipboardCommands()) {
    if (await writeWith(command, text)) return true;
  }
  logToFile('[clipboard] no working clipboard command found');
  return false;
}

/**
 * Platform browser-open commands, in preference order. The URL is one argv
 * element — never concatenated into a shell string — so a `?kind=…` query or
 * any other character can't escape into the command line.
 *
 * `win32` has no shell-free single binary for this: `start` is a `cmd` builtin,
 * so we invoke `cmd /c start "" <url>` (the empty `""` is `start`'s window-title
 * argument, which would otherwise swallow the URL). The URL is still a discrete
 * argv element, not interpolated into the command string.
 *
 * Takes `platform` as an argument (defaulting to the host) so the mapping is a
 * pure function the tests can exercise across platforms.
 */
export function browserOpenCommands(
  url: string,
  platform: NodeJS.Platform = process.platform,
): ClipboardCommand[] {
  if (platform === 'darwin') return [{ cmd: 'open', args: [url] }];
  if (platform === 'win32') {
    return [{ cmd: 'cmd', args: ['/c', 'start', '', url] }];
  }
  // Linux / BSD: xdg-open is the freedesktop standard; x-www-browser is the
  // Debian alternatives fallback.
  return [
    { cmd: 'xdg-open', args: [url] },
    { cmd: 'x-www-browser', args: [url] },
  ];
}

function spawnOpener({ cmd, args }: ClipboardCommand): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      // Detach the opener's stdio so it can't write over the Ink TUI, and
      // resolve on a clean exit. ENOENT (missing binary) surfaces as 'error'.
      const child = spawn(cmd, args, { stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    } catch (err) {
      analytics.captureException(
        err instanceof Error ? err : new Error(String(err)),
        { step: 'spawn_opener' },
      );
      resolve(false);
    }
  });
}

export async function openInBrowser(url: string): Promise<boolean> {
  for (const command of browserOpenCommands(url)) {
    if (await spawnOpener(command)) return true;
  }
  logToFile('[clipboard] no working browser-open command found');
  return false;
}
