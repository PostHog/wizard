import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseArgs } from 'util';
import { startServeHost, waitFor } from '@e2e-harness/serve-host';

const TERMINAL_COLUMNS = 100;
const TERMINAL_ROWS = 30;
const HOLD_AFTER_TARGET_MS = 3000;
const RECORDING_TIMEOUT_MS = 90_000;
const SCREEN_POLL_MS = 150;

function readFlagsOrExit() {
  const { values: flags } = parseArgs({
    options: {
      program: { type: 'string' },
      app: { type: 'string' },
      'until-screen': { type: 'string' },
      out: { type: 'string' },
    },
  });
  const program = flags.program;
  const sourceAppDir = flags.app;
  const targetScreen = flags['until-screen'];
  const castPath = flags.out;
  if (program && sourceAppDir && targetScreen && castPath)
    return { program, sourceAppDir, targetScreen, castPath };
  process.stderr.write(
    'usage: pnpm wizard-ci-record --program <id> --app <dir> --until-screen <screen-id> --out <file.cast>\n',
  );
  return process.exit(2);
}

const { program, sourceAppDir, targetScreen, castPath } = readFlagsOrExit();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function copyAppToThrowawayDir(appDir: string): string {
  const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-record-app-'));
  fs.cpSync(path.resolve(appDir), copyDir, {
    recursive: true,
    filter: (source) => path.basename(source) !== 'node_modules',
  });
  return copyDir;
}

function currentScreenOf(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null) return undefined;
  const screen = (state as { currentScreen?: unknown }).currentScreen;
  return typeof screen === 'string' ? screen : undefined;
}

function writeCastHeader(castFile: number) {
  fs.writeSync(
    castFile,
    JSON.stringify({
      version: 2,
      width: TERMINAL_COLUMNS,
      height: TERMINAL_ROWS,
      timestamp: Math.floor(Date.now() / 1000),
      env: { TERM: 'xterm-256color' },
    }) + '\n',
  );
}

async function recordUntilTargetScreen(
  castFile: number,
  appCopyDir: string,
  registerCleanup: (cleanup: () => void) => void,
): Promise<number> {
  writeCastHeader(castFile);
  const recordingStartedAt = performance.now();
  const host = startServeHost({
    appDir: appCopyDir,
    projectId: '1',
    program,
    apiKey: '',
    cols: TERMINAL_COLUMNS,
    rows: TERMINAL_ROWS,
    onOutput: (chunk) => {
      const elapsedSeconds = (performance.now() - recordingStartedAt) / 1000;
      fs.writeSync(
        castFile,
        JSON.stringify([Number(elapsedSeconds.toFixed(6)), 'o', chunk]) + '\n',
      );
    },
  });
  registerCleanup(() => host.dispose());
  let hostExitCode: number | undefined;
  void host.capture.exited.then((code) => (hostExitCode = code));

  const deadline = Date.now() + RECORDING_TIMEOUT_MS;
  const socketReady = await host.waitForSocketOrExit(RECORDING_TIMEOUT_MS);
  let lastScreen: string | undefined;
  while (socketReady && hostExitCode === undefined && Date.now() < deadline) {
    const response = await host.rpc({ type: 'read_state' }).catch(() => null);
    lastScreen = currentScreenOf(response?.state) ?? lastScreen;
    if (lastScreen === targetScreen) {
      await waitFor(() => hostExitCode !== undefined, HOLD_AFTER_TARGET_MS);
      process.stdout.write(`recorded ${castPath} ending on ${targetScreen}\n`);
      return 0;
    }
    await sleep(SCREEN_POLL_MS);
  }

  await waitFor(() => hostExitCode !== undefined, SCREEN_POLL_MS);
  const reason =
    hostExitCode === undefined
      ? `timed out after ${RECORDING_TIMEOUT_MS}ms`
      : `the TUI host exited with code ${hostExitCode}`;
  process.stderr.write(
    `never reached screen ${targetScreen}: ${reason}; last screen ${
      lastScreen ?? 'none'
    }; partial recording kept at ${castPath}\n`,
  );
  return 1;
}

async function main(): Promise<number> {
  const castFile = fs.openSync(castPath, 'w');
  const cleanups: Array<() => void> = [() => fs.closeSync(castFile)];
  const runCleanups = () => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  };
  const exitOnSignal = () => {
    runCleanups();
    process.exit(130);
  };
  process.once('SIGINT', exitOnSignal);
  process.once('SIGTERM', exitOnSignal);
  try {
    const appCopyDir = copyAppToThrowawayDir(sourceAppDir);
    cleanups.push(() =>
      fs.rmSync(appCopyDir, { recursive: true, force: true }),
    );
    return await recordUntilTargetScreen(castFile, appCopyDir, (cleanup) =>
      cleanups.push(cleanup),
    );
  } finally {
    runCleanups();
  }
}

main().then(
  (exitCode) => process.exit(exitCode),
  (error: unknown) => {
    process.stderr.write(
      `wizard-ci-record: ${
        error instanceof Error ? error.stack ?? error.message : String(error)
      }\n`,
    );
    process.exit(1);
  },
);
