/**
 * Full-frame snapshots of the REAL TUI: capture on every terminal write,
 * dedupe on exact frame equality only, keep the host's CTRL labels as
 * annotations. Local run tooling — not committed.
 *
 *   SNAP_OUT=/tmp/snaps APP_DIR=/tmp/app PROGRAM=metrics \
 *   POSTHOG_KEY_FILE=… PROJECT_ID=… npx tsx scripts/tui-snapshots-full.no-jest.ts
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
  if (/^(CLAUDE|ANTHROPIC)/.test(k)) delete env[k];

const started = Date.now();
const cap = captureTui({
  cmd: path.join(process.cwd(), 'node_modules/.bin/tsx'),
  args: ['scripts/tui-host.no-jest.ts'],
  cwd: process.cwd(),
  env,
});

let seq = 0;
let lastFrame = '';
let pending = false;

function snap(label?: string) {
  const plain = cap.frame();
  if (plain === lastFrame && !label) return;
  lastFrame = plain;
  seq += 1;
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const name = `${String(seq).padStart(4, '0')}${label ? `-${label}` : ''}+${elapsed}s.ans`;
  fs.writeFileSync(path.join(OUT, name), cap.frameAnsi());
}

// Capture after each burst of writes settles (frames mid-write are torn).
cap.onData(() => {
  if (pending) return;
  pending = true;
  setTimeout(() => {
    pending = false;
    snap();
  }, 60);
});

// Carry the host's key-moment labels through as annotated frames.
let ctrlPos = 0;
const ctrlTimer = setInterval(() => {
  const data = fs.readFileSync(CTRL, 'utf8').slice(ctrlPos);
  ctrlPos += data.length;
  for (const raw of data.split('\n')) {
    const label = raw.trim();
    if (label) snap(label);
  }
}, 150);

void cap.exited.then(() => {
  snap('final');
  clearInterval(ctrlTimer);
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  // eslint-disable-next-line no-console
  console.log(`done; ${seq} frames in ${OUT}; ${secs}s wall`);
  process.exit(0);
});
