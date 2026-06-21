/**
 * Replay a recorded wizard run in the terminal.
 *
 *   tsx scripts/replay-e2e.no-jest.ts <recording.json> [--step] [--delay <ms>]
 *
 * --step   advance frame-by-frame on Enter (default)
 * --delay  auto-play with <ms> between frames (e.g. --delay 1200)
 */
import { createInterface } from 'readline';
import type { ProgramId } from '@ui/tui/router';
import { loadRecording, renderFrame, frameHeader } from '@lib/ci-driver/replay';

const ENTER_ALT = '\x1b[?1049h';
const LEAVE_ALT = '\x1b[?1049l';
const CLEAR = '\x1b[2J\x1b[H';

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('-'));
  if (!file) {
    process.stderr.write(
      'usage: replay-e2e <recording.json> [--step] [--delay <ms>]\n',
    );
    process.exit(2);
  }
  const delayArg = args.indexOf('--delay');
  const autoDelay = delayArg !== -1 ? Number(args[delayArg + 1]) : null;
  const step = autoDelay === null; // default to step unless --delay given

  const rec = loadRecording(file);
  const program = rec.meta.program as ProgramId;
  const total = rec.frames.length;

  process.stdout.write(ENTER_ALT);
  const cleanup = () => process.stdout.write(LEAVE_ALT);
  process.on('exit', cleanup);

  const rl = step
    ? createInterface({ input: process.stdin, output: process.stdout })
    : null;
  const ask = (q: string) =>
    new Promise<void>((res) => rl!.question(q, () => res()));
  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

  for (const frame of rec.frames) {
    process.stdout.write(CLEAR);
    process.stdout.write(`\x1b[2m${rec.meta.app ?? rec.meta.program}\x1b[0m\n`);
    process.stdout.write(frameHeader(frame, total) + '\n\n');
    process.stdout.write(renderFrame(frame, program) + '\n');
    if (step) {
      await ask(
        `\n\x1b[2m[${
          frame.seq + 1
        }/${total}] Enter ▸ next · Ctrl-C ▸ quit\x1b[0m`,
      );
    } else {
      await sleep(autoDelay!);
    }
  }

  rl?.close();
  cleanup();
  process.stdout.write(`\nReplayed ${total} frames from ${file}\n`);
  process.exit(0);
}

main().catch((e) => {
  process.stdout.write(LEAVE_ALT);
  process.stderr.write(`replay failed: ${e?.stack ?? e}\n`);
  process.exit(1);
});
