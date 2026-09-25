import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openCodingAgent } from '../services/coding-agent-launcher';

vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}));

const originalPlatform = process.platform;
let folder: string;
let exitCode = 0;

beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), 'wizard-launch-test-'));
  writeFileSync(path.join(folder, 'codex'), '', { mode: 0o700 });
  writeFileSync(path.join(folder, 'codex.cmd'), '', { mode: 0o700 });
  vi.stubEnv('PATH', folder);
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  exitCode = 0;
  vi.mocked(spawn).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    queueMicrotask(() => child.emit('exit', exitCode));
    return child as unknown as ChildProcess;
  });
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  rmSync(folder, { recursive: true, force: true });
  // The spawned terminal is mocked, so the self-deleting script never runs.
  for (const entry of readdirSync(tmpdir()))
    if (entry.startsWith('wizard-handoff-'))
      rmSync(path.join(tmpdir(), entry), { recursive: true, force: true });
});

const open = () =>
  openCodingAgent('codex', folder, path.join(folder, 'README.md'));

it('hands a .command file to the macOS default handler', async () => {
  await open();
  const [[cmd, args]] = vi.mocked(spawn).mock.calls;
  expect(cmd).toBe('/usr/bin/open');
  expect(args).toHaveLength(1);
  expect(String(args?.[0])).toMatch(/open-agent\.command$/);
});

it('uses start, and so the default terminal app, on Windows', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  vi.stubEnv('ComSpec', 'C:\\Windows\\system32\\cmd.exe');
  await open();
  const [[cmd, args]] = vi.mocked(spawn).mock.calls;
  expect(cmd).toBe('C:\\Windows\\system32\\cmd.exe');
  expect(args?.slice(0, 3)).toEqual(['/d', '/s', '/c']);
  expect(String(args?.[3])).toMatch(
    /^"start "" C:\\Windows\\system32\\cmd\.exe \/d \/c ".*open-agent\.cmd""$/,
  );
});

it('rejects a missing agent before opening anything', async () => {
  vi.stubEnv('PATH', path.join(folder, 'nothing-here'));
  await expect(open()).rejects.toThrow('could not be found');
  expect(spawn).not.toHaveBeenCalled();
});

it('reports a launch failure and removes the script', async () => {
  exitCode = 1;
  await expect(open()).rejects.toThrow('Could not open a terminal');
  const [[, args]] = vi.mocked(spawn).mock.calls;
  expect(existsSync(String(args?.[0]))).toBe(false);
});
