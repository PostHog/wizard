import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseArgs } from 'util';
import { openCastWriter, type CastWriter } from '@e2e-harness/asciicast';
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
      html: { type: 'string' },
    },
  });
  const program = flags.program;
  const sourceAppDir = flags.app;
  const targetScreen = flags['until-screen'];
  const castPath = flags.out;
  const replayPagePath = flags.html;
  if (program && sourceAppDir && targetScreen && castPath)
    return { program, sourceAppDir, targetScreen, castPath, replayPagePath };
  process.stderr.write(
    'usage: pnpm wizard-ci-record --program <id> --app <dir> --until-screen <screen-id> --out <file.cast> [--html <file.html>]\n',
  );
  return process.exit(2);
}

const { program, sourceAppDir, targetScreen, castPath, replayPagePath } =
  readFlagsOrExit();

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
    if (lastScreen === targetScreen) {
      await waitFor(() => hostExitCode !== undefined, HOLD_AFTER_TARGET_MS);
      cast.close();
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

async function recordCast(): Promise<number> {
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
    return await recordUntilTargetScreen(cast, appCopyDir, (cleanup) =>
      cleanups.push(cleanup),
    );
  } finally {
    runCleanups();
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
  const exitCode = await recordCast();
  if (replayPagePath) writeReplayPage(castPath, replayPagePath);
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
