import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseArgs } from 'util';
import { spawn } from 'child_process';
import { openCastWriter, type CastWriter } from '@e2e-harness/asciicast';
import { startServeHost, waitFor } from '@e2e-harness/serve-host';

const TERMINAL_COLUMNS = 100;
const TERMINAL_ROWS = 30;
const HOLD_AFTER_TARGET_MS = 3000;
const RECORDING_TIMEOUT_MS = 90_000;
const DRIVEN_RECORDING_TIMEOUT_MS = 30 * 60_000;
const SCREEN_POLL_MS = 150;

function readFlagsOrExit() {
  const { values: flags } = parseArgs({
    options: {
      program: { type: 'string' },
      app: { type: 'string' },
      'until-screen': { type: 'string' },
      out: { type: 'string' },
      html: { type: 'string' },
      drive: { type: 'boolean' },
    },
  });
  const program = flags.program;
  const sourceAppDir = flags.app;
  const targetScreen = flags['until-screen'];
  const castPath = flags.out;
  const replayPagePath = flags.html;
  const isDriven = flags.drive ?? false;
  if (program && sourceAppDir && castPath && (targetScreen || isDriven))
    return {
      program,
      sourceAppDir,
      targetScreen,
      castPath,
      replayPagePath,
      isDriven,
    };
  process.stderr.write(
    'usage: pnpm wizard-ci-record --program <id> --app <dir> --until-screen <screen-id> --out <file.cast> [--html <file.html>]\n' +
      '       pnpm wizard-ci-record --drive --program <id> --app <dir> [--until-screen <screen-id>] --out <file.cast> [--html <file.html>]\n',
  );
  return process.exit(2);
}

const {
  program,
  sourceAppDir,
  targetScreen,
  castPath,
  replayPagePath,
  isDriven,
} = readFlagsOrExit();

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

async function recordUntilTargetScreen(
  untilScreen: string,
  cast: CastWriter,
  appCopyDir: string,
  registerCleanup: (cleanup: () => void) => void,
): Promise<number> {
  const host = startServeHost({
    appDir: appCopyDir,
    projectId: '1',
    program,
    apiKey: '',
    cols: TERMINAL_COLUMNS,
    rows: TERMINAL_ROWS,
    onOutput: cast.appendOutput,
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
    if (lastScreen === untilScreen) {
      await waitFor(() => hostExitCode !== undefined, HOLD_AFTER_TARGET_MS);
      cast.close();
      process.stdout.write(`recorded ${castPath} ending on ${untilScreen}\n`);
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
    `never reached screen ${untilScreen}: ${reason}; last screen ${
      lastScreen ?? 'none'
    }; partial recording kept at ${castPath}\n`,
  );
  return 1;
}

async function recordCast(untilScreen: string): Promise<number> {
  const cast = openCastWriter(castPath, {
    cols: TERMINAL_COLUMNS,
    rows: TERMINAL_ROWS,
  });
  const cleanups: Array<() => void> = [() => cast.close()];
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
    return await recordUntilTargetScreen(
      untilScreen,
      cast,
      appCopyDir,
      (cleanup) => cleanups.push(cleanup),
    );
  } finally {
    runCleanups();
  }
}

function missingDriveCredential(): string | undefined {
  if (!process.env.POSTHOG_PERSONAL_API_KEY && !process.env.POSTHOG_KEY_FILE)
    return 'POSTHOG_PERSONAL_API_KEY or POSTHOG_KEY_FILE';
  if (!process.env.PROJECT_ID) return 'PROJECT_ID';
  if (!process.env.WIZARD_CI_GATEWAY_TOKEN_FILE)
    return 'WIZARD_CI_GATEWAY_TOKEN_FILE';
  return undefined;
}

function screensSignalledIn(controlFile: string): string[] {
  if (!fs.existsSync(controlFile)) return [];
  return fs
    .readFileSync(controlFile, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

async function recordDrivenRun(): Promise<number> {
  const missingCredential = missingDriveCredential();
  if (missingCredential) {
    process.stderr.write(`--drive needs ${missingCredential} set\n`);
    return 2;
  }
  fs.writeFileSync(castPath, '');
  const appCopyDir = copyAppToThrowawayDir(sourceAppDir);
  const snapshotDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'wizard-record-snaps-'),
  );
  const controlFile = path.join(snapshotDir, 'ctrl');
  const snapshotRoute = spawn(
    path.join(process.cwd(), 'node_modules/.bin/tsx'),
    ['scripts/tui-snapshots.no-jest.ts'],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env,
        SNAP_RECORD: '1',
        SNAP_OUT: snapshotDir,
        APP_DIR: appCopyDir,
        PROGRAM: program,
        PTY_COLS: String(TERMINAL_COLUMNS),
        PTY_ROWS: String(TERMINAL_ROWS),
      },
    },
  );
  let routeExitCode: number | undefined;
  const routeExited = new Promise<void>((resolve) =>
    snapshotRoute.once('exit', (code, signal) => {
      routeExitCode = code ?? (signal ? 128 : 1);
      resolve();
    }),
  );
  const stopRoute = () => snapshotRoute.kill('SIGTERM');
  let wasInterrupted = false;
  const stopRouteOnSignal = () => {
    wasInterrupted = true;
    stopRoute();
  };
  process.on('SIGINT', stopRouteOnSignal);
  process.on('SIGTERM', stopRouteOnSignal);

  try {
    const deadline = Date.now() + DRIVEN_RECORDING_TIMEOUT_MS;
    let reachedScreen: string | undefined;
    while (routeExitCode === undefined && Date.now() < deadline) {
      if (
        targetScreen &&
        screensSignalledIn(controlFile).includes(targetScreen)
      ) {
        reachedScreen = targetScreen;
        await waitFor(() => routeExitCode !== undefined, HOLD_AFTER_TARGET_MS);
        break;
      }
      await sleep(SCREEN_POLL_MS);
    }
    const hasTimedOut = routeExitCode === undefined && !reachedScreen;
    stopRoute();
    await routeExited;

    const routeCast = path.join(snapshotDir, 'run.cast');
    if (fs.existsSync(routeCast)) fs.copyFileSync(routeCast, castPath);
    if (wasInterrupted) return 130;
    if (reachedScreen) {
      process.stdout.write(`recorded ${castPath} ending on ${reachedScreen}\n`);
      return 0;
    }
    const lastScreen = screensSignalledIn(controlFile).at(-1) ?? 'none';
    if (hasTimedOut || targetScreen) {
      const reason = hasTimedOut
        ? `timed out after ${DRIVEN_RECORDING_TIMEOUT_MS}ms`
        : `the driven run exited with code ${routeExitCode ?? 'unknown'}`;
      process.stderr.write(
        `${
          targetScreen
            ? `never reached screen ${targetScreen}`
            : 'the driven run did not finish'
        }: ${reason}; last screen ${lastScreen}; partial recording kept at ${castPath}\n`,
      );
      return 1;
    }
    process.stdout.write(
      `recorded ${castPath} ending on ${lastScreen}; driven run exited ${
        routeExitCode ?? 'unknown'
      }\n`,
    );
    return routeExitCode ?? 1;
  } finally {
    process.off('SIGINT', stopRouteOnSignal);
    process.off('SIGTERM', stopRouteOnSignal);
    fs.rmSync(appCopyDir, { recursive: true, force: true });
    fs.rmSync(snapshotDir, { recursive: true, force: true });
  }
}

function readPlayerAsset(fileName: string): string {
  return fs.readFileSync(
    path.join(
      process.cwd(),
      'node_modules/asciinema-player/dist/bundle',
      fileName,
    ),
    'utf8',
  );
}

function writeReplayPage(castFilePath: string, pagePath: string) {
  const castText = fs.readFileSync(castFilePath, 'utf8');
  const playerScript = readPlayerAsset('asciinema-player.min.js').replace(
    /<\/script/gi,
    '<\\/script',
  );
  const playerStyles = readPlayerAsset('asciinema-player.css');
  const castLiteral = JSON.stringify(castText).replace(/</g, '\\u003c');
  const page = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Wizard recording</title>
<style>${playerStyles}</style>
<style>body{margin:0;background:#121314;display:grid;place-items:center;min-height:100vh}#player{width:min(100vw,1200px)}</style>
</head>
<body>
<div id="player"></div>
<script>${playerScript}</script>
<script>AsciinemaPlayer.create({ data: ${castLiteral} }, document.getElementById('player'), { autoPlay: true, fit: 'width' });</script>
</body>
</html>
`;
  fs.writeFileSync(pagePath, page);
  process.stdout.write(`wrote replay page ${pagePath}\n`);
}

async function main(): Promise<number> {
  const exitCode =
    targetScreen && !isDriven
      ? await recordCast(targetScreen)
      : await recordDrivenRun();
  if (replayPagePath && exitCode !== 2 && fs.existsSync(castPath))
    writeReplayPage(castPath, replayPagePath);
  return exitCode;
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
