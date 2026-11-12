import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import { captureTui, type TuiCapture } from './tui-capture';

export interface ServeHostResponse {
  ok: boolean;
  state?: unknown;
  error?: string;
  runStatus?: string;
}

export interface ServeHost {
  capture: TuiCapture;
  rpc(request: object): Promise<ServeHostResponse>;
  waitForSocketOrExit(timeoutMs: number): Promise<boolean>;
  dispose(): void;
}

const RPC_TIMEOUT_MS = 600_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(
  condition: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await sleep(150);
  }
  return false;
}

function withoutHostAgentAuth(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source };
  for (const name of Object.keys(env))
    if (/^(CLAUDE|ANTHROPIC|AI_AGENT)/.test(name)) delete env[name];
  return env;
}

function keyEnvWithoutWritingInlineKeyToDisk(
  keyFile: string | undefined,
  apiKey: string | undefined,
): NodeJS.ProcessEnv {
  if (keyFile) return { POSTHOG_KEY_FILE: keyFile };
  return { POSTHOG_PERSONAL_API_KEY: (apiKey ?? '').trim() };
}

export function startServeHost(opts: {
  appDir: string;
  projectId: string;
  program?: string;
  region?: 'us' | 'eu';
  keyFile?: string;
  apiKey?: string;
  cols?: number;
  rows?: number;
  onOutput?: (chunk: string) => void;
}): ServeHost {
  const controlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-ci-'));
  const socketPath = path.join(controlDir, 'host.sock');
  const env: NodeJS.ProcessEnv = {
    ...withoutHostAgentAuth(process.env),
    MODE: 'serve',
    CONTROL_SOCK: socketPath,
    SNAP_CTRL: path.join(controlDir, 'ctrl'),
    APP_DIR: opts.appDir,
    PROJECT_ID: opts.projectId,
    POSTHOG_REGION: opts.region ?? 'us',
    ...(opts.program ? { PROGRAM: opts.program } : {}),
    ...keyEnvWithoutWritingInlineKeyToDisk(opts.keyFile, opts.apiKey),
  };
  const capture = captureTui({
    cmd: path.join(process.cwd(), 'node_modules/.bin/tsx'),
    args: ['--tsconfig', 'tsconfig.base.json', 'scripts/tui-host.no-jest.ts'],
    cwd: process.cwd(),
    env,
    cols: opts.cols,
    rows: opts.rows,
  });
  if (opts.onOutput) capture.onData(opts.onOutput);
  let hasHostExited = false;
  void capture.exited.then(() => (hasHostExited = true));

  function rpc(request: object): Promise<ServeHostResponse> {
    return new Promise((resolve, reject) => {
      const sock = net.connect(socketPath);
      let buffered = '';
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error('control socket timeout'));
      }, RPC_TIMEOUT_MS);
      sock.on('connect', () => sock.write(JSON.stringify(request) + '\n'));
      sock.on('data', (d) => {
        buffered += d;
        const newlineAt = buffered.indexOf('\n');
        if (newlineAt < 0) return;
        clearTimeout(timer);
        sock.end();
        resolve(JSON.parse(buffered.slice(0, newlineAt)) as ServeHostResponse);
      });
      sock.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  return {
    capture,
    rpc,
    waitForSocketOrExit: async (timeoutMs) =>
      (await waitFor(
        () => hasHostExited || fs.existsSync(socketPath),
        timeoutMs,
      )) && !hasHostExited,
    dispose() {
      capture.kill();
      fs.rmSync(controlDir, { recursive: true, force: true });
    },
  };
}
