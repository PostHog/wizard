import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { HostResolution } from '@shared/host-resolution';
import { OutroKind } from '@shared/outro';
import { RunPhase } from '@shared/run-state';
import type {
  ControlHooks,
  ControlMode,
  ControlSurface,
} from '@shared/control/types';
import { buildSession } from '@tui/session';
import { WizardStore } from '@tui/store';
import { wizardStoreControlTarget } from '@tui/control/index';
import { ControlClient, ControlClientError } from '../client';
import {
  attachControlServer,
  MAX_BODY_BYTES,
  type ControlServerHandle,
} from '../server';

vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn(), setTag: vi.fn(), capture: vi.fn() },
  sessionProperties: () => ({}),
}));

const handles: ControlServerHandle[] = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((h) => h.close()));
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

function socketDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wz-ctl-'));
  dirs.push(dir);
  return dir;
}

const US = HostResolution.fromApiHost('https://us.posthog.com');

async function serve(
  options: {
    surface?: ControlSurface;
    mode?: ControlMode;
    apiKey?: string | null;
    runMs?: number;
    runFails?: boolean;
  } = {},
) {
  const surface = options.surface ?? 'headless';
  const store = new WizardStore('posthog-integration');
  store.session = buildSession({
    installDir: '/tmp/control-server',
    ...(options.apiKey === null
      ? {}
      : { apiKey: options.apiKey ?? 'phx_test_key' }),
  });
  const hooks: ControlHooks = {
    setCredentials: vi.fn(() => {
      store.setCredentials({
        accessToken: 'phx_SECRET',
        projectApiKey: 'phc_TOKEN',
        host: US,
        projectId: 7,
      });
      return Promise.resolve();
    }),
    ...(surface === 'headless'
      ? {
          detect: vi.fn(() => {
            store.setDetectionComplete();
            return Promise.resolve();
          }),
          startRun: vi.fn(async () => {
            store.setRunPhase(RunPhase.Running);
            await new Promise((r) => setTimeout(r, options.runMs ?? 30));
            if (options.runFails) throw new Error('agent crashed');
            store.setOutroData({ kind: OutroKind.Success, message: 'done' });
            store.setRunPhase(RunPhase.Completed);
          }),
        }
      : {}),
    shutdown: vi.fn(() => Promise.resolve()),
  };
  const socketPath = path.join(socketDir(), 'c.sock');
  const handle = await attachControlServer(
    wizardStoreControlTarget(store, { screens: surface === 'tui' }),
    {
      socketPath,
      surface,
      mode: options.mode ?? 'partial',
      hooks,
      version: '0.0.0-test',
      program: 'posthog-integration',
    },
  );
  handles.push(handle);
  return {
    store,
    hooks,
    handle,
    socketPath,
    client: new ControlClient(socketPath),
  };
}

function raw(
  socketPath: string,
  method: string,
  reqPath: string,
  body?: string,
  headers: Record<string, string> = {},
) {
  return new Promise<{ status: number; json: Record<string, unknown> }>(
    (resolve, reject) => {
      const req = http.request(
        { socketPath, method, path: reqPath, headers },
        (res) => {
          let text = '';
          res.on('data', (c: Buffer) => (text += c.toString()));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              json: JSON.parse(text) as Record<string, unknown>,
            }),
          );
        },
      );
      req.on('error', reject);
      if (body !== undefined) req.write(body);
      req.end();
    },
  );
}

const statusOf = async (p: Promise<unknown>): Promise<number> => {
  try {
    await p;
    return 200;
  } catch (err) {
    return err instanceof ControlClientError ? err.status : -1;
  }
};

describe('control server', () => {
  it('answers health with the surface, mode and program', async () => {
    const { client } = await serve({ mode: 'full' });
    await expect(client.health()).resolves.toMatchObject({
      ok: true,
      surface: 'headless',
      mode: 'full',
      program: 'posthog-integration',
    });
  });

  it('serves the TUI screen and applies its actions through the store', async () => {
    const { client, store } = await serve({ surface: 'tui' });
    const state = await client.state();
    expect(state.currentScreen).toBe('intro');
    expect(state.actions.map((a) => a.id)).toEqual(['confirm_setup']);

    const after = await client.performAction('confirm_setup', { share: false });
    expect(store.session.setupConfirmed).toBe(true);
    expect(after.session.setupConfirmed).toBe(true);
    expect(after.currentScreen).not.toBe('intro');
  });

  it('refuses an action the current screen does not offer, and unknown routes', async () => {
    const { client, socketPath } = await serve({ surface: 'tui' });
    expect(await statusOf(client.performAction('keep_skills'))).toBe(400);
    expect((await raw(socketPath, 'GET', '/nope')).status).toBe(404);
    expect(
      (
        await raw(socketPath, 'POST', '/state', '{}', {
          'content-type': 'application/json',
        })
      ).status,
    ).toBe(404);
  });

  it('lists setters in partial mode but refuses to call them', async () => {
    const { client, store } = await serve({ mode: 'partial' });
    const setters = await client.setters();
    expect(setters.map((s) => s.name)).toContain('setRunPhase');

    expect(await statusOf(client.applySetter('completeSetup'))).toBe(403);
    expect(store.session.setupConfirmed).toBe(false);
  });

  it('applies any setter under full control and lists each write', async () => {
    const { client, store } = await serve({ mode: 'full' });
    const state = await client.applySetter('setFrameworkContext', {
      key: 'packageManager',
      value: 'pnpm',
    });
    expect(store.session.frameworkContext.packageManager).toBe('pnpm');
    expect(state.controlWrites.map((w) => w.setter)).toEqual([
      'setFrameworkContext',
    ]);
    expect(await statusOf(client.applySetter('noSuchSetter'))).toBe(400);
    expect(
      await statusOf(client.applySetter('setRunPhase', { phase: 'bogus' })),
    ).toBe(400);
  });

  it('never records a run from written state; only POST /runs does', async () => {
    const { client } = await serve({ mode: 'full' });
    await client.applySetter('setRunPhase', { phase: RunPhase.Completed });
    expect(await client.runs()).toEqual([]);
    const state = await client.state();
    expect(state.session.runPhase).toBe(RunPhase.Completed);
    expect(state.controlWrites.map((w) => w.setter)).toEqual(['setRunPhase']);
  });

  it('runs one run at a time and records the outcome and final state', async () => {
    const { client } = await serve({ runMs: 50 });
    const run = await client.startRun({
      programId: 'metrics',
      installDir: 'apps/web',
    });
    expect(run).toMatchObject({
      programId: 'metrics',
      status: 'running',
      installDir: '/tmp/control-server/apps/web',
    });
    expect(await statusOf(client.startRun({ programId: 'metrics' }))).toBe(409);
    expect(await statusOf(client.detect())).toBe(409);
    expect(await statusOf(client.shutdown())).toBe(409);

    await vi.waitFor(async () => {
      const [record] = await client.runs();
      expect(record.status).toBe('done');
      expect(record.result?.session.runPhase).toBe(RunPhase.Completed);
    });
  });

  it('records a failed run with its error', async () => {
    const { client } = await serve({ runFails: true });
    await client.startRun({ skillId: 'audit-events' });
    await vi.waitFor(async () => {
      const [record] = await client.runs();
      expect(record).toMatchObject({
        programId: 'agent-skill',
        skillId: 'audit-events',
        status: 'failed',
        error: 'agent crashed',
      });
    });
  });

  it('answers 501 for headless-only routes on the TUI surface', async () => {
    const { client } = await serve({ surface: 'tui' });
    expect(await statusOf(client.startRun({ programId: 'metrics' }))).toBe(501);
    expect(await statusOf(client.detect())).toBe(501);
  });

  it('refuses an unknown program and a malformed run config', async () => {
    const { client } = await serve();
    expect(
      await statusOf(client.startRun({ programId: 'nope' as never })),
    ).toBe(400);
    expect(
      await statusOf(
        client.startRun({
          programId: 'metrics',
          config: { mystery: true } as never,
        }),
      ),
    ).toBe(400);
  });

  it('resolves credentials through the hook without projecting a secret', async () => {
    const { client, hooks } = await serve();
    const state = await client.setCredentials();
    expect(hooks.setCredentials).toHaveBeenCalledOnce();
    expect(state.session).toMatchObject({ hasCredentials: true, projectId: 7 });
    expect(JSON.stringify(state)).not.toMatch(/phx_SECRET|phc_TOKEN/);
  });

  it('refuses credentials for a session without an API key', async () => {
    const { client } = await serve({ apiKey: null });
    expect(await statusOf(client.setCredentials())).toBe(400);
  });

  it('redacts secret-named framework context', async () => {
    const { client } = await serve({ mode: 'full' });
    const state = await client.applySetter('setFrameworkContext', {
      key: 'uploadApiKey',
      value: 'hunter2',
    });
    expect(state.session.frameworkContext).toMatchObject({
      uploadApiKey: '[redacted]',
    });
  });

  it('long polls until the next commit and times out otherwise', async () => {
    const { client, store } = await serve();
    const { version } = await client.state();
    const waiting = client.waitForChange(version, 5000);
    setTimeout(() => store.setDetectionComplete(), 20);
    expect((await waiting).version).toBeGreaterThan(version);

    const idle = await client.waitForChange(version + 1000, 50);
    expect(idle.version).toBeLessThanOrEqual(version + 1000);
  });

  it('answers 413 past the body cap and 415 for non-JSON', async () => {
    const { socketPath } = await serve();
    const big = JSON.stringify({ params: { x: 'y'.repeat(MAX_BODY_BYTES) } });
    expect(
      (
        await raw(socketPath, 'POST', '/actions/x', big, {
          'content-type': 'application/json',
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await raw(socketPath, 'POST', '/actions/x', 'x', {
          'content-type': 'text/plain',
        })
      ).status,
    ).toBe(415);
  });

  it('owns its socket: 0600, a live one refused, a stale one replaced, unlinked on close', async () => {
    const { handle, socketPath } = await serve();
    expect(fs.statSync(socketPath).mode & 0o777).toBe(0o600);
    const store = new WizardStore('posthog-integration');
    await expect(
      attachControlServer(wizardStoreControlTarget(store, { screens: false }), {
        socketPath,
        surface: 'headless',
        mode: 'partial',
        hooks: { setCredentials: vi.fn(), shutdown: vi.fn() },
        version: 't',
        program: 'p',
      }),
    ).rejects.toThrow('already served');
    await handle.close();
    expect(fs.existsSync(socketPath)).toBe(false);

    // A crashed wizard leaves a dead socket file behind; the next one replaces it.
    const child = spawn(
      process.execPath,
      [
        '-e',
        "require('net').createServer().listen(process.argv[1], () => process.stdout.write('ok'))",
        socketPath,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    await new Promise<void>((resolve) =>
      child.stdout.once('data', () => resolve()),
    );
    const exited = new Promise<void>((resolve) =>
      child.once('exit', () => resolve()),
    );
    child.kill('SIGKILL');
    await exited;
    const replaced = await attachControlServer(
      wizardStoreControlTarget(store, { screens: false }),
      {
        socketPath,
        surface: 'headless',
        mode: 'partial',
        hooks: { setCredentials: vi.fn(), shutdown: vi.fn() },
        version: 't',
        program: 'p',
      },
    );
    handles.push(replaced);
    expect(fs.existsSync(socketPath)).toBe(true);
  });

  it('shuts down once through the hook', async () => {
    const { client, hooks } = await serve();
    await client.shutdown();
    await vi.waitFor(() => expect(hooks.shutdown).toHaveBeenCalledOnce());
  });
});
