import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  credentialFailures,
  integrationFailures,
  type CapturedFrame,
  type LiveE2eResult,
} from '../e2e-harness/live-e2e-checks';

type TestCase = {
  name: string;
  fixture: string;
  dependencies: string[];
  devReady: string;
  prodCommand: string;
  prodReady: string;
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases: TestCase[] = [
  {
    name: 'Vite',
    fixture: 'react-vite-test-app',
    dependencies: ['posthog-js'],
    devReady: 'ready in',
    prodCommand: 'preview',
    prodReady: 'Local:',
  },
  {
    name: 'NextJS',
    fixture: 'nextjs-app-router-test-app',
    dependencies: ['posthog-js', 'posthog-node'],
    devReady: 'Ready in',
    prodCommand: 'start',
    prodReady: 'Ready in',
  },
];

function hasReadableContent(file: string): boolean {
  try {
    return (
      fs.statSync(file).isFile() &&
      fs.readFileSync(file, 'utf8').trim().length > 0
    );
  } catch {
    return false;
  }
}

function stopProcess(child: ReturnType<typeof spawn>): void {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-12_000);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => {
      stopProcess(child);
      reject(
        new Error(`${command} timed out after ${timeoutMs / 1000}s. ${output}`),
      );
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

async function waitForOutput(
  args: string[],
  cwd: string,
  expected: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npm', args, {
      cwd,
      env: { ...process.env, CI: '1' },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stopProcess(child);
      if (error) reject(error);
      else resolve();
    };
    const read = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8_000);
      if (output.includes(expected)) finish();
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (!settled)
        finish(new Error(`npm ${args.join(' ')} exited ${code}: ${output}`));
    });
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            `npm ${args.join(' ')} did not print "${expected}": ${output}`,
          ),
        ),
      120_000,
    );
  });
}

function copyFixture(source: string, destination: string): void {
  fs.cpSync(source, destination, {
    recursive: true,
    filter: (entry) =>
      !['.git', 'node_modules', '.next', 'dist'].includes(path.basename(entry)),
  });
}

function readResult(file: string): LiveE2eResult | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as LiveE2eResult;
  } catch {
    return null;
  }
}

function readFrames(directory: string): CapturedFrame[] {
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.ans'))
    .sort()
    .map((name) => ({
      name,
      text: fs.readFileSync(path.join(directory, name), 'utf8'),
    }));
}

async function runCase(testCase: TestCase): Promise<void> {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-live-e2e-'));
  const app = path.join(temporary, 'app');
  const snaps = path.join(temporary, 'snaps');
  const resultPath = path.join(temporary, 'result.json');
  try {
    copyFixture(
      path.join(root, 'e2e-tests', 'test-applications', testCase.fixture),
      app,
    );
    fs.mkdirSync(snaps);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      APP_DIR: app,
      SNAP_OUT: snaps,
      E2E_RESULT_JSON: resultPath,
      PROJECT_ID:
        process.env.PROJECT_ID ?? process.env.POSTHOG_WIZARD_PROJECT_ID,
    };
    for (const name of Object.keys(env)) {
      if (/^(CLAUDE|ANTHROPIC|AI_AGENT)/.test(name)) delete env[name];
    }

    console.log(`Running ${testCase.name} through the real TUI…`);
    const run = await runCommand(
      path.join(root, 'node_modules', '.bin', 'tsx'),
      ['scripts/tui-snapshots.no-jest.ts'],
      root,
      env,
      20 * 60_000,
    );
    const result = readResult(resultPath);
    const frames = readFrames(snaps);
    const failures = integrationFailures(result, frames);
    if (run.code !== 0) failures.unshift(`TUI capture exited ${run.code}.`);
    if (failures.length > 0) {
      throw new Error(`${failures.join('\n')}\n${run.output}`);
    }

    const pkg = JSON.parse(
      fs.readFileSync(path.join(app, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const installed = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const dependency of testCase.dependencies) {
      if (!(dependency in installed)) {
        throw new Error(
          `Integration did not add ${dependency} to package.json.`,
        );
      }
    }
    const build = await runCommand(
      'npm',
      ['run', 'build'],
      app,
      process.env,
      180_000,
    );
    if (build.code !== 0) throw new Error(`App build failed:\n${build.output}`);
    await waitForOutput(['run', 'dev'], app, testCase.devReady);
    await waitForOutput(['run', testCase.prodCommand], app, testCase.prodReady);
    console.log(`${testCase.name}: passed (${frames.length} TUI frames).`);
  } finally {
    if (process.env.E2E_KEEP_ARTIFACTS === '1') {
      console.log(`${testCase.name} artifacts: ${temporary}`);
    } else {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
}

async function main(): Promise<void> {
  const failures = credentialFailures(process.env, hasReadableContent);
  if (failures.length > 0) {
    throw new Error(
      `Live e2e needs explicit credentials:\n${failures.join('\n')}`,
    );
  }

  const pattern = process.argv.slice(2).join(' ').trim().toLowerCase();
  const selected = pattern
    ? cases.filter((testCase) => testCase.name.toLowerCase().includes(pattern))
    : cases;
  if (selected.length === 0) {
    throw new Error(`No e2e case matches "${pattern}". Choose Vite or NextJS.`);
  }

  const build = await runCommand('pnpm', ['build'], root, process.env, 180_000);
  if (build.code !== 0)
    throw new Error(`Wizard build failed:\n${build.output}`);
  for (const testCase of selected) await runCase(testCase);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
