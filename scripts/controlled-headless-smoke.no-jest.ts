/**
 * Drive a published-style headless run over its control socket: detect, then
 * one independent run per program named on the command line, then shutdown.
 * Prints every request and a redacted view of every response.
 *
 *   POSTHOG_WIZARD_API_KEY=… npx tsx scripts/controlled-headless-smoke.no-jest.ts \
 *     --app /tmp/app --project-id 228144 [--region us] [--bin dist/bin.js] posthog-integration [metrics …]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HEADLESS_FLAG } from '@env';
import { ControlClient } from '@store/control';
import type { ControlState } from '@store/types';

async function waitForSocket(p: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(p)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`the wizard did not open ${p} within ${timeoutMs}ms`);
}

const args = process.argv.slice(2);
const opt = (name: string, fallback?: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const programs = args.filter(
  (a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')),
);
const app = opt('app');
const projectId = opt('project-id');
const region = opt('region', 'us')!;
const bin = opt('bin', 'bin.ts')!;
if (!app || !projectId || programs.length === 0) {
  process.stderr.write(
    'usage: --app <dir> --project-id <id> [--region us|eu] [--bin dist/bin.js] <program> [program…]\n',
  );
  process.exit(2);
}
if (!process.env.POSTHOG_WIZARD_API_KEY) {
  process.stderr.write(
    'POSTHOG_WIZARD_API_KEY must be set in the environment\n',
  );
  process.exit(2);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-ctl-'));
const socketPath = path.join(dir, 'w.sock');
const cmd = bin.endsWith('.ts')
  ? path.join(process.cwd(), 'node_modules/.bin/tsx')
  : 'node';
const argv = [
  bin,
  `--${HEADLESS_FLAG}`,
  '--control-socket',
  socketPath,
  '--project-id',
  projectId,
  '--region',
  region,
  '--install-dir',
  app,
];
const log = (line: string) => process.stdout.write(`${line}\n`);
log(
  `$ ${cmd === 'node' ? 'node' : 'npx tsx'} ${argv.join(
    ' ',
  )}   # POSTHOG_WIZARD_API_KEY in env`,
);
const env = { ...process.env };
for (const k of Object.keys(env))
  if (/^(CLAUDE|ANTHROPIC|AI_AGENT)/.test(k)) delete env[k];
const child = spawn(cmd, argv, {
  cwd: process.cwd(),
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const wizardOut: string[] = [];
child.stdout.on('data', (d: Buffer) => wizardOut.push(d.toString()));
child.stderr.on('data', (d: Buffer) => wizardOut.push(d.toString()));
const exit = new Promise<number | null>((resolve) =>
  child.once('exit', (code) => resolve(code)),
);

const brief = (s: ControlState) => ({
  version: s.version,
  screen: s.currentScreen,
  runPhase: s.runPhase,
  run: s.run,
  integration: s.session.integration,
  detectionComplete: s.session.detectionComplete,
  hasCredentials: s.session.hasCredentials,
  tasks: s.tasks.map((t) => `${t.status}:${t.label}`),
  dashboardUrl: s.dashboardUrl,
  notebookUrl: s.notebookUrl,
  outro: s.outroData,
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
    while (state.run.status === 'running') {
      state = await client.waitForChange(state.version, 60_000);
      const last = state.tasks
        .filter((t) => t.status !== 'pending')
        .slice(-1)[0];
      log(
        `  GET /state?wait=60000&since=${state.version} -> screen=${
          state.currentScreen
        } runPhase=${state.runPhase} run=${state.run.status} tasks=${
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
  const console = wizardOut
    .join('')
    .replace(/phx_[A-Za-z0-9_]+/g, 'phx_<redacted>')
    .trim();
  if (console) log(`wizard console:\n${console}`);
  process.exit(code === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  process.stderr.write(`smoke failed: ${(e as Error)?.stack ?? String(e)}\n`);
  child.kill('SIGKILL');
  process.exit(1);
});
