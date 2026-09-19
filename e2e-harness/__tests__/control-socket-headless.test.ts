/**
 * The published headless surface, driven over its socket: a real `bin.ts`
 * process, no agent run. Detection and runs need credentials, so this covers
 * the plumbing every controlled run shares.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ControlClient } from '@store/control';
import { HEADLESS_FLAG } from '@env';
import { waitForSocket } from '@e2e-harness/launch';

const REPO = path.resolve(__dirname, '../..');
let child: ChildProcess | null = null;
let dir: string | null = null;

afterEach(() => {
  child?.kill('SIGKILL');
  child = null;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('controlled headless surface', () => {
  it('serves the API, refuses the TUI route, and exits 0 on shutdown', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wz-headless-'));
    const app = path.join(dir, 'app');
    fs.mkdirSync(app);
    const socketPath = path.join(dir, 'w.sock');
    const env = { ...process.env };
    delete env.POSTHOG_WIZARD_API_KEY;
    child = spawn(
      path.join(REPO, 'node_modules/.bin/tsx'),
      [
        'bin.ts',
        `--${HEADLESS_FLAG}`,
        '--control-socket',
        socketPath,
        '--api-key',
        'phx_test_only',
        '--project-id',
        '1',
        '--region',
        'us',
        '--install-dir',
        app,
      ],
      { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const exit = new Promise<number | null>((resolve) =>
      child!.once('exit', (code) => resolve(code)),
    );
    await waitForSocket(socketPath, 90_000);
    expect(fs.statSync(socketPath).mode & 0o777).toBe(0o600);

    const client = new ControlClient(socketPath);
    expect(await client.health()).toMatchObject({
      surface: 'headless',
      program: 'posthog-integration',
    });
    const state = await client.state();
    expect(state.currentScreen).toBe('intro');
    expect(state.run).toEqual({ status: 'idle', error: null });
    expect(JSON.stringify(state)).not.toContain('phx_test_only');
    await expect(client.startRun({ programId: 'nope' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(client.armRun()).rejects.toMatchObject({ status: 501 });
    expect(await client.runs()).toEqual([]);

    await client.shutdown();
    expect(await exit).toBe(0);
    expect(fs.existsSync(socketPath)).toBe(false);
  }, 120_000);
});
