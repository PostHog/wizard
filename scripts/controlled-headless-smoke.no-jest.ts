/**
 * Drive a published-style headless run over its control socket: detect, then
 * one independent run per program named on the command line, then shutdown.
 * Prints every request and a redacted view of every response.
 *
 *   APP_DIR=/tmp/app PROJECT_ID=228144 POSTHOG_REGION=us POSTHOG_KEY_FILE=… \
 *   WIZARD_CI_GATEWAY_TOKEN_FILE=… npx tsx scripts/controlled-headless-smoke.no-jest.ts \
 *     posthog-integration [metrics …]
 *
 * WIZARD_BIN=dist/bin.js runs a built binary instead of the source tree.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { RunPhase } from '@store';
import { ControlClient } from '@store/control';
import type { ControlState, ProgramId } from '@store/types';
import { buildLaunch, readApiKey, waitForSocket } from '@e2e-harness/launch';

const programs = process.argv.slice(2) as ProgramId[];
const appDir = process.env.APP_DIR;
const projectId = process.env.PROJECT_ID;
const apiKey = readApiKey();
if (!appDir || !projectId || programs.length === 0 || !apiKey) {
  process.stderr.write(
    'usage: APP_DIR=<dir> PROJECT_ID=<id> [POSTHOG_REGION=us|eu] POSTHOG_KEY_FILE=<file> ' +
      'npx tsx scripts/controlled-headless-smoke.no-jest.ts <program> [program…]\n',
  );
  process.exit(2);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-ctl-'));
const socketPath = path.join(dir, 'w.sock');
const launch = buildLaunch({
  programId: programs[0],
  appDir,
  socketPath,
  projectId,
  region: process.env.POSTHOG_REGION === 'eu' ? 'eu' : 'us',
  apiKey,
  surface: 'headless',
  bin: process.env.WIZARD_BIN,
});
const log = (line: string) => process.stdout.write(`${line}\n`);
log(
  `$ ${launch.cmd.endsWith('tsx') ? 'npx tsx' : launch.cmd} ${launch.args.join(
    ' ',
  )}   # POSTHOG_WIZARD_API_KEY in env`,
);
const child = spawn(launch.cmd, launch.args, {
  cwd: process.cwd(),
  env: launch.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const childOutput: string[] = [];
child.stdout.on('data', (d: Buffer) => childOutput.push(d.toString()));
child.stderr.on('data', (d: Buffer) => childOutput.push(d.toString()));
const exit = new Promise<number | null>((resolve) =>
  child.once('exit', (code) => resolve(code)),
);

const brief = (s: ControlState) => ({
  version: s.version,
  screen: s.currentScreen,
  runPhase: s.session.runPhase,
  integration: s.session.integration,
  detectionComplete: s.session.detectionComplete,
  hasCredentials: s.session.hasCredentials,
  tasks: s.tasks.map((t) => `${t.status}:${t.label}`),
  dashboardUrl: s.session.dashboardUrl,
  notebookUrl: s.session.notebookUrl,
  outro: s.session.outroData,
});

async function main(): Promise<void> {
  await waitForSocket(socketPath, 120_000);
  const client = new ControlClient(socketPath);
  log(`GET /health -> ${JSON.stringify(await client.health())}`);
  log(`GET /state -> ${JSON.stringify(brief(await client.state()))}`);
  log(`POST /detect {} -> ${JSON.stringify(brief(await client.detect({})))}`);
  for (const programId of programs) {
    const record = await client.startRun({ programId });
    log(`POST /runs {"programId":"${programId}"} -> ${JSON.stringify(record)}`);
    let state = await client.state();
    while (state.session.runPhase === RunPhase.Running) {
      state = await client.waitForChange(state.version, 60_000);
      const last = state.tasks
        .filter((t) => t.status !== 'pending')
        .slice(-1)[0];
      log(
        `  GET /state?wait=60000&since=${state.version} -> screen=${
          state.currentScreen
        } runPhase=${state.session.runPhase} tasks=${
          state.tasks.filter((t) => t.status === 'completed').length
        }/${state.tasks.length}${
          last ? ` last=${last.status}:${last.label}` : ''
        }`,
      );
    }
    log(`  final -> ${JSON.stringify(brief(state))}`);
  }
  log(`GET /runs -> ${JSON.stringify(await client.runs(), null, 2)}`);
  log(
    `POST /shutdown -> ${JSON.stringify(
      await client.shutdown().then(() => ({ ok: true })),
    )}`,
  );
  const code = await exit;
  log(`wizard exit code: ${code}`);
  log(`socket removed: ${!fs.existsSync(socketPath)}`);
  const output = childOutput
    .join('')
    .replace(/phx_[A-Za-z0-9_]+/g, 'phx_<redacted>')
    .trim();
  if (output) log(`wizard console:\n${output}`);
  process.exit(code === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  process.stderr.write(`smoke failed: ${(e as Error)?.stack ?? String(e)}\n`);
  child.kill('SIGKILL');
  process.exit(1);
});
