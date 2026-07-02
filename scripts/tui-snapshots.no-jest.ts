/**
 * Fixed-route snapshots of the REAL TUI (Node, single-stack).
 *
 * Spawns the real-TUI host (MODE=fixed) in a PTY, lets it self-drive the fixed
 * e2e profile through the real agent run, and writes the real rendered screen to
 * SNAP_OUT/<variation>/NN-<screen>.txt at each key moment the host signals.
 *
 * Runs one capture per switchboard variation declared in the program's e2e.json
 * (`variations`) — default / pi-anthropic-linear / pi-openai-linear — threading
 * each variation's harness/sequence/model to the host via SNAP_* env.
 *
 *   SNAP_OUT=/tmp/snaps APP_DIR=/tmp/app POSTHOG_KEY_FILE=… PROJECT_ID=… \
 *     npx tsx scripts/tui-snapshots.no-jest.ts
 */
import fs from 'fs';
import path from 'path';
import { captureTui } from '@e2e-harness/tui-capture';
import { variationsFor } from '@e2e-harness/profiles';
import { Program } from '@lib/programs/program-registry';

const BASE = process.env.SNAP_OUT!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One real agent run for a single variation, snapshotting each screen. */
async function captureVariation(v: {
  name: string;
  harness?: string;
  sequence?: string;
  model?: string;
}): Promise<number> {
  const OUT = path.join(BASE, v.name);
  const CTRL = path.join(OUT, 'ctrl');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(CTRL, '');

  // Fresh app copy per variation so each scenario's diff is clean. When
  // APP_FIXTURE is set, copy it to <OUT>/app; otherwise fall back to APP_DIR.
  let appDir = process.env.APP_DIR;
  if (process.env.APP_FIXTURE) {
    appDir = path.join(OUT, 'app');
    fs.cpSync(process.env.APP_FIXTURE, appDir, {
      recursive: true,
      filter: (src) => !/\/(node_modules|\.next|\.git)(\/|$)/.test(src),
    });
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MODE: 'fixed',
    APP_DIR: appDir,
    SNAP_CTRL: CTRL,
    SNAP_HARNESS: v.harness ?? '',
    SNAP_SEQUENCE: v.sequence ?? '',
    SNAP_MODEL: v.model ?? '',
  };
  for (const k of Object.keys(env))
    if (/^(CLAUDE|ANTHROPIC)/.test(k)) delete env[k]; // gateway auth via phx, not host creds

  const cap = captureTui({
    cmd: path.join(process.cwd(), 'node_modules/.bin/tsx'),
    args: ['scripts/tui-host.no-jest.ts'],
    cwd: process.cwd(),
    env,
  });

  let pos = 0;
  let seq = 0;
  const drainCtrl = async () => {
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
      console.log(`snap [${v.name}] ->`, path.basename(fn));
    }
  };

  const timer = setInterval(() => void drainCtrl(), 150);
  await cap.exited;
  await drainCtrl();
  clearInterval(timer);
  // eslint-disable-next-line no-console
  console.log(`done [${v.name}]; ${seq} snapshots in ${OUT}`);
  return seq;
}

async function main() {
  // Sequential — each is a real agent run (gateway spend + a single PTY).
  // SNAP_ONLY=<name> restricts to one variation (debug / re-run a single scenario).
  const only = process.env.SNAP_ONLY;
  const variations = variationsFor(Program.PostHogIntegration).filter(
    (v) => !only || v.name === only,
  );
  for (const v of variations) {
    await captureVariation(v);
  }
  process.exit(0);
}

void main();
