/**
 * Best-effort clipboard write — no third-party dependency.
 *
 * Used as a fallback so users can paste a URL their terminal can't linkify
 * (e.g. macOS Terminal.app, which lacks OSC 8 hyperlink support). Shells out to
 * the platform clipboard binary over stdin; never throws — returns false when no
 * clipboard command is reachable (CI, headless, or the binary isn't installed).
 *
 * Text is passed via stdin (never as an argv) so there's no shell-injection
 * surface, and `spawn` runs without a shell.
 */
import { spawn } from 'node:child_process';
import { logToFile } from './debug.js';

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
    } catch {
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
