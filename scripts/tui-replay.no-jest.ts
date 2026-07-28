/**
 * Replay captured real-TUI snapshots in the terminal — step through or auto-play
 * the `NN-<screen>.txt` frames a snapshot run dropped in SNAP_OUT.
 *
 *   npx tsx scripts/tui-replay.no-jest.ts <snap-dir> [--step | --delay <ms>]
 *   pnpm wizard-ci-replay /tmp/snaps                 # Enter ▸ advance (default)
 *   pnpm wizard-ci-replay /tmp/snaps --delay 1200    # auto-play
 */
import fs from 'fs';
import path from 'path';
import { createInterface } from 'readline';

const dir = process.argv[2] || process.env.SNAP_OUT;
const args = process.argv.slice(3);
const delayIdx = args.indexOf('--delay');
const delay = delayIdx >= 0 ? Number(args[delayIdx + 1]) : null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clear = () => process.stdout.write('\x1b[2J\x1b[3J\x1b[H');

async function pressEnter(prompt: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((res) => rl.question(prompt, () => res()));
  rl.close();
}

async function main() {
  if (!dir || !fs.existsSync(dir)) {
    console.error(
      `✖ snapshot dir not found: ${
        dir ?? '(none)'
      }\n  usage: tui-replay <snap-dir> [--step | --delay <ms>]`,
    );
    process.exit(2);
  }
  const frames = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.txt') && f !== 'latest.txt')
    .sort();
  if (frames.length === 0) {
    console.error(`✖ no NN-<screen>.txt snapshots in ${dir}`);
    process.exit(1);
  }
  // Step (Enter to advance) is the default; fall back to a timed play when not a
  // TTY (e.g. CI) so it never hangs, or when --delay is given.
  const autoMs = delay ?? (process.stdin.isTTY ? null : 600);

  for (let i = 0; i < frames.length; i++) {
    clear();
    process.stdout.write(fs.readFileSync(path.join(dir, frames[i]), 'utf8'));
    process.stdout.write(`\n  [${i + 1}/${frames.length}] ${frames[i]}\n`);
    if (i === frames.length - 1) break;
    if (autoMs != null) await sleep(autoMs);
    else await pressEnter('  ⏎ next ▸ ');
  }
  process.stdout.write('\n  ✓ end of snapshots\n');
  process.exit(0);
}
main();
