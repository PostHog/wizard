/**
 * Run a command in a PTY and read its real terminal screen.
 *
 * The shared capture primitive for both e2e routes: spawn the real-TUI host in a
 * pseudo-terminal (node-pty) so it renders the real ink TUI, feed its output to a
 * headless xterm emulator, and read the current screen as clean text on demand.
 */
import fsmod from 'fs';
import pathmod from 'path';
import * as pty from 'node-pty';
import { createRequire } from 'module';

// @xterm/headless ships CJS; its `module` field points at the full browser build,
// so import the headless CJS entry directly to get a working Terminal in Node.
const require = createRequire(import.meta.url);
const { Terminal } =
  require('@xterm/headless') as typeof import('@xterm/headless');

// node-pty's prebuilt macOS/Linux spawn-helper can lose its execute bit when the
// package is extracted without running its build script (e.g. pnpm skips it),
// which makes pty.spawn fail with "posix_spawnp failed". Restore it, best-effort.
function ensureSpawnHelper(): void {
  try {
    const root = pathmod.dirname(require.resolve('node-pty/package.json'));
    const dir = pathmod.join(
      root,
      'prebuilds',
      `${process.platform}-${process.arch}`,
    );
    const helper = pathmod.join(dir, 'spawn-helper');
    if (fsmod.existsSync(helper)) fsmod.chmodSync(helper, 0o755);
  } catch {
    /* best-effort */
  }
}

export interface TuiCapture {
  /** The current rendered screen as clean text (trailing blank lines trimmed). */
  frame(): string;
  /** Fires after each chunk of terminal output is applied. */
  onData(cb: () => void): void;
  kill(): void;
  /** Resolves when the child exits. */
  exited: Promise<void>;
}

export function captureTui(opts: {
  cmd: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
}): TuiCapture {
  // Default to a roomy, full-screen-terminal-ish size (overridable per call or
  // via PTY_COLS / PTY_ROWS) so the TUI renders the way it would on a real Mac
  // terminal rather than cramped. The PTY winsize drives ink's layout.
  const cols = opts.cols ?? (Number(process.env.PTY_COLS) || 180);
  const rows = opts.rows ?? (Number(process.env.PTY_ROWS) || 50);
  ensureSpawnHelper();
  const term = new Terminal({ cols, rows, allowProposedApi: true });
  const child = pty.spawn(opts.cmd, opts.args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: opts.cwd,
    env: opts.env as { [key: string]: string },
  });

  const cbs: Array<() => void> = [];
  child.onData((d) => {
    term.write(d);
    for (const cb of cbs) cb();
  });
  let resolveExit!: () => void;
  const exited = new Promise<void>((r) => (resolveExit = r));
  child.onExit(() => resolveExit());

  return {
    frame() {
      const buf = term.buffer.active;
      const lines: string[] = [];
      for (let i = 0; i < rows; i++) {
        const line = buf.getLine(i);
        lines.push(line ? line.translateToString(true) : '');
      }
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      return lines.join('\n') + '\n';
    },
    onData(cb) {
      cbs.push(cb);
    },
    kill() {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    },
    exited,
  };
}
