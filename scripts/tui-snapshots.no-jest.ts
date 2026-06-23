/**
 * Fixed-route snapshots of the REAL TUI (Node, single-stack).
 *
 * Spawns the real-TUI host (MODE=fixed) in a PTY, lets it self-drive the fixed
 * e2e profile through the real agent run, and writes the real rendered screen to
 * SNAP_OUT/NN-<screen>.txt at each key moment the host signals.
 *
 *   SNAP_OUT=/tmp/snaps APP_DIR=/tmp/app POSTHOG_KEY_FILE=… PROJECT_ID=… \
 *     npx tsx scripts/tui-snapshots.no-jest.ts
 */
import fs from 'fs';
import path from 'path';
import { captureTui } from '@e2e-harness/tui-capture';

const OUT = process.env.SNAP_OUT!;
const CTRL = path.join(OUT, 'ctrl');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(CTRL, '');

const env: NodeJS.ProcessEnv = {
  ...process.env,
  MODE: 'fixed',
  SNAP_CTRL: CTRL,
};
for (const k of Object.keys(env))
  if (/^(CLAUDE|ANTHROPIC)/.test(k)) delete env[k]; // gateway auth via phx, not host creds

const cap = captureTui({
  cmd: path.join(process.cwd(), 'node_modules/.bin/tsx'),
  args: ['scripts/tui-host.no-jest.ts'],
  cwd: process.cwd(),
  env,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let pos = 0;
let seq = 0;
async function drainCtrl() {
  const data = fs.readFileSync(CTRL, 'utf8').slice(pos);
  pos += data.length;
  for (const raw of data.split('\n')) {
    const label = raw.trim();
    if (!label) continue;
    await sleep(200); // let xterm apply the final writes for this screen
    seq += 1;
    const fn = path.join(OUT, `${String(seq).padStart(2, '0')}-${label}.txt`);
    fs.writeFileSync(fn, cap.frame());
    // eslint-disable-next-line no-console
    console.log('snap ->', path.basename(fn));
  }
}

const timer = setInterval(() => void drainCtrl(), 150);
void cap.exited.then(async () => {
  await drainCtrl();
  clearInterval(timer);
  // eslint-disable-next-line no-console
  console.log(`done; ${seq} snapshots in ${OUT}`);
  process.exit(0);
});
