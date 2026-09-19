import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { HostResolution } from '../../host-resolution.js';
import { Program } from '../../programs/program-registry.js';
import { OutroKind, RunPhase } from '../../session/wizard-session.js';
import { createControlledStore, expectNoSecrets } from '../../testing/index.js';
import { ControlClient, ControlClientError } from '../client.js';
import {
  attachControlServer,
  MAX_BODY_BYTES,
  type ControlServerHandle,
} from '../server.js';
import type { ControlHooks, ControlSurface } from '../types.js';

const handles: ControlServerHandle[] = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((h) => h.close()));
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function socketDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wz-ctl-'));
  dirs.push(dir);
  return dir;
}

/** A socket file whose server died without unlinking: what a crashed wizard leaves. */
async function staleSocket(socketPath: string): Promise<void> {
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
}

const US = HostResolution.fromApiHost('https://us.posthog.com');

async function serve(
  surface: ControlSurface = 'headless',
  program = Program.PostHogIntegration,
  options: { apiKey?: string | null; runMs?: number } = {},
) {
  const store = createControlledStore(program, {
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
    detect: vi.fn(() => {
      store.setDetectionComplete();
      return Promise.resolve();
    }),
    startRun: vi.fn(async () => {
      store.setRunPhase(RunPhase.Running);
      await new Promise((r) => setTimeout(r, options.runMs ?? 30));
      store.setOutroData({ kind: OutroKind.Success, message: 'done' });
      store.setRunPhase(RunPhase.Completed);
    }),
    shutdown: vi.fn(() => Promise.resolve()),
  };
  const socketPath = path.join(socketDir(), 'c.sock');
  const handle = await attachControlServer(store, {
    socketPath,
    surface,
    hooks,
    version: '0.0.0-test',
    program,
  });
  handles.push(handle);
  return {
    store,
    hooks,
    handle,
    socketPath,
    client: new ControlClient(socketPath),
  };
}

/** A raw request, for the malformed cases the client cannot produce. */
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

const JSON_HEADERS = { 'content-type': 'application/json' };
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('control server', () => {
  it('answers health with the surface and program', async () => {
    const { client } = await serve('tui', Program.Audit);
    expect(await client.health()).toEqual({
      ok: true,
      surface: 'tui',
      program: Program.Audit,
      pid: process.pid,
      version: '0.0.0-test',
    });
  });

  it('serves the state and applies actions through their setters', async () => {
    const { client, store } = await serve();
    const before = await client.state();
    expect(before.currentScreen).toBe('intro');
    expect(before.actions.map((a) => a.id)).toEqual(['confirm_setup']);
    const after = await client.performAction('confirm_setup');
    expect(after.session.setupConfirmed).toBe(true);
    expect(after.version).toBeGreaterThan(before.version);
    expect(store.session.setupConfirmed).toBe(true);
  });

  it('maps bad input to 400 and unknown routes to 404', async () => {
    const { client, socketPath } = await serve();
    await expect(client.performAction('keep_skills')).rejects.toMatchObject({
      status: 400,
    });
    expect((await raw(socketPath, 'GET', '/nope')).status).toBe(404);
    expect(
      (await raw(socketPath, 'POST', '/nope', '{}', JSON_HEADERS)).status,
    ).toBe(404);
    expect(
      (
        await raw(
          socketPath,
          'POST',
          '/actions/confirm_setup',
          '{',
          JSON_HEADERS,
        )
      ).status,
    ).toBe(400);
    expect(
      (await raw(socketPath, 'POST', '/actions/%zz', '{}', JSON_HEADERS))
        .status,
    ).toBe(400);
    expect(
      (
        await raw(
          socketPath,
          'POST',
          '/actions/confirm_setup',
          '{"params":[]}',
          JSON_HEADERS,
        )
      ).status,
    ).toBe(400);
    expect(
      (await raw(socketPath, 'POST', '/runs', '{}', JSON_HEADERS)).status,
    ).toBe(400);
  });

  it('rejects a missing param with 400 and the param name', async () => {
    const { client, store } = await serve(
      'headless',
      Program.ErrorTrackingUploadSourceMaps,
    );
    store.completeSetup();
    store.setCredentials({
      accessToken: 't',
      projectApiKey: 'k',
      host: US,
      projectId: 1,
    });
    expect((await client.state()).currentScreen).toBe('source-maps-detect');
    await expect(
      client.performAction('pick_source_maps_project', { variant: 'node' }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('"path"'),
    });
  });

  it('answers 413 past the body cap, 200 at it, and 415 for non-JSON', async () => {
    const { socketPath } = await serve();
    const wrap = (pad: string) => JSON.stringify({ params: { pad } });
    const overhead = wrap('').length;
    const atLimit = wrap('x'.repeat(MAX_BODY_BYTES - overhead));
    expect(Buffer.byteLength(atLimit)).toBe(MAX_BODY_BYTES);
    expect(
      (
        await raw(
          socketPath,
          'POST',
          '/actions/confirm_setup',
          atLimit,
          JSON_HEADERS,
        )
      ).status,
    ).toBe(200);
    const over = await raw(
      socketPath,
      'POST',
      '/actions/confirm_setup',
      wrap('x'.repeat(MAX_BODY_BYTES - overhead + 1)),
      JSON_HEADERS,
    );
    expect(over.status).toBe(413);
    expect(over.json.error).toContain(String(MAX_BODY_BYTES));
    expect(
      (
        await raw(socketPath, 'POST', '/actions/confirm_setup', 'x', {
          'content-type': 'text/plain',
        })
      ).status,
    ).toBe(415);
  });

  it('long polls until the next commit, and returns on timeout', async () => {
    const { client, store } = await serve();
    const since = (await client.state()).version;
    const pending = client.waitForChange(since, 5000);
    setTimeout(() => store.completeSetup(), 20);
    const state = await pending;
    expect(state.version).toBeGreaterThan(since);
    expect(state.session.setupConfirmed).toBe(true);

    const started = Date.now();
    const timedOut = await client.waitForChange(state.version, 60);
    expect(timedOut.version).toBe(state.version);
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
  });

  it('reads immediately for a non-numeric wait and times out for a version ahead of the store', async () => {
    const { client, socketPath } = await serve();
    const current = (await client.state()).version;
    const started = Date.now();
    const immediate = await raw(socketPath, 'GET', '/state?wait=abc&since=0');
    expect(immediate.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(500);
    const ahead = await client.waitForChange(current + 100, 60);
    expect(ahead.version).toBe(current);
  });

  it('wakes every concurrent poller on one commit', async () => {
    const { client, store } = await serve();
    const since = (await client.state()).version;
    const a = client.waitForChange(since, 5000);
    const b = client.waitForChange(since, 5000);
    setTimeout(() => store.completeSetup(), 20);
    const [sa, sb] = await Promise.all([a, b]);
    expect(sa.version).toBe(sb.version);
    expect(sa.version).toBeGreaterThan(since);
  });

  it('answers pending long polls when it closes instead of holding the process', async () => {
    const { client, handle } = await serve();
    const since = (await client.state()).version;
    const started = Date.now();
    const pending = client.waitForChange(since, 5000);
    await settle(20);
    await handle.close();
    const state = await pending;
    expect(state.version).toBe(since);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('owns its socket: 0600, a dead socket replaced, a live one refused, a plain file refused, unlinked on close', async () => {
    const dir = socketDir();
    const stale = path.join(dir, 'stale.sock');
    await staleSocket(stale);
    expect(fs.existsSync(stale)).toBe(true);
    const store = createControlledStore();
    const hooks = {
      setCredentials: vi.fn(),
      detect: vi.fn(),
      startRun: vi.fn(),
      shutdown: vi.fn(),
    } as unknown as ControlHooks;
    const attach = (socketPath: string) =>
      attachControlServer(store, {
        socketPath,
        surface: 'tui',
        hooks,
        version: 't',
        program: 'p',
      });
    const handle = await attach(stale);
    expect(fs.statSync(stale).mode & 0o777).toBe(0o600);
    expect((await new ControlClient(stale).health()).ok).toBe(true);

    const live = path.join(dir, 'live.sock');
    const other = net.createServer().listen(live);
    await new Promise((r) => other.once('listening', r));
    await expect(attach(live)).rejects.toThrow(/already served/);
    other.close();

    const file = path.join(dir, 'not-a-socket');
    fs.writeFileSync(file, 'keep me');
    await expect(attach(file)).rejects.toThrow(/not a socket/);
    expect(fs.readFileSync(file, 'utf8')).toBe('keep me');

    await handle.close();
    expect(fs.existsSync(stale)).toBe(false);
  });

  it('runs one independent run at a time and records the resolved request in the ledger', async () => {
    const { client, hooks, store } = await serve('headless');
    const run = await client.startRun({
      programId: Program.PostHogIntegration,
      installDir: 'apps/web',
      frameworkContext: { picked: 'yes' },
      skillId: 'nextjs',
    });
    const absolute = path.join(store.session.installDir, 'apps/web');
    expect(run).toMatchObject({
      status: 'running',
      programId: Program.PostHogIntegration,
      installDir: absolute,
    });
    expect(hooks.startRun).toHaveBeenCalledWith({
      programId: Program.PostHogIntegration,
      installDir: absolute,
      frameworkContext: { picked: 'yes' },
      skillId: 'nextjs',
    });
    await expect(
      client.startRun({ programId: Program.PostHogIntegration }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await client.state()).session.runPhase).toBe(RunPhase.Running);

    await settle(80);
    const runs = await client.runs();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      runId: run.runId,
      status: 'done',
      error: null,
    });
    expect(runs[0].result?.session).toMatchObject({
      runPhase: RunPhase.Completed,
      outroData: { kind: OutroKind.Success, message: 'done' },
    });
    expect(runs[0].finishedAt).not.toBeNull();
    expect((await client.state()).session.runPhase).toBe(RunPhase.Completed);
  });

  it('drops nothing silently: a non-object frameworkContext is a 400', async () => {
    const { socketPath, hooks } = await serve('headless');
    const r = await raw(
      socketPath,
      'POST',
      '/runs',
      JSON.stringify({
        programId: Program.PostHogIntegration,
        frameworkContext: [],
      }),
      JSON_HEADERS,
    );
    expect(r.status).toBe(400);
    expect(hooks.startRun).not.toHaveBeenCalled();
  });

  it('keeps runs in start order and hands out copies', async () => {
    const { client, store } = await serve(
      'headless',
      Program.PostHogIntegration,
      {
        runMs: 5,
      },
    );
    await client.startRun({ programId: Program.Metrics });
    await settle(40);
    await client.startRun({ programId: Program.Audit });
    await settle(40);
    const runs = await client.runs();
    expect(runs.map((r) => [r.programId, r.status])).toEqual([
      [Program.Metrics, 'done'],
      [Program.Audit, 'done'],
    ]);
    expect(runs.every((r) => r.installDir === store.session.installDir)).toBe(
      true,
    );
    runs[0].status = 'failed';
    expect((await client.runs())[0].status).toBe('done');
  });

  it('records a failed run with its error and the state at failure', async () => {
    const { client, hooks } = await serve('headless');
    vi.mocked(hooks.startRun).mockRejectedValueOnce(
      new Error('gateway refused'),
    );
    await client.startRun({ programId: Program.PostHogIntegration });
    await settle(20);
    const [record] = await client.runs();
    expect(record).toMatchObject({
      status: 'failed',
      error: 'gateway refused',
    });
    expect(record.result?.currentScreen).toBe('intro');
  });

  it('refuses detection, credentials, and shutdown while a run is in flight', async () => {
    const { client, hooks } = await serve(
      'headless',
      Program.PostHogIntegration,
      {
        runMs: 150,
      },
    );
    await client.startRun({ programId: Program.PostHogIntegration });
    await expect(client.detect({})).rejects.toMatchObject({ status: 409 });
    await expect(client.setCredentials()).rejects.toMatchObject({
      status: 409,
    });
    await expect(client.shutdown()).rejects.toMatchObject({ status: 409 });
    expect(hooks.detect).not.toHaveBeenCalled();
    expect(hooks.setCredentials).not.toHaveBeenCalled();
    expect(hooks.shutdown).not.toHaveBeenCalled();
    await settle(200);
    await client.shutdown();
    await settle(10);
    expect(hooks.shutdown).toHaveBeenCalledTimes(1);
  });

  it('treats a running TUI phase as in flight too', async () => {
    const { client, store, hooks } = await serve('tui');
    store.setRunPhase(RunPhase.Running);
    await expect(client.shutdown()).rejects.toMatchObject({ status: 409 });
    expect(hooks.shutdown).not.toHaveBeenCalled();
  });

  it('serves each surface its own hooks and answers 501 for the other', async () => {
    const headless = await serve('headless');
    await expect(headless.client.armRun()).rejects.toMatchObject({
      status: 501,
    });
    expect(
      (await headless.client.detect({ programId: Program.Audit })).session
        .detectionComplete,
    ).toBe(true);
    expect(headless.hooks.detect).toHaveBeenCalledWith({
      programId: Program.Audit,
    });

    const tui = await serve('tui');
    await expect(
      tui.client.startRun({ programId: Program.Audit }),
    ).rejects.toMatchObject({ status: 501 });
    await expect(tui.client.detect()).rejects.toMatchObject({ status: 501 });
    expect((await tui.client.armRun()).session.runRequested).toBe(true);
    expect(tui.store.session.runRequested).toBe(true);
    expect((await tui.client.armRun()).session.runRequested).toBe(true);
  });

  it('resolves a relative detect install dir against the live one', async () => {
    const { client, hooks, store } = await serve('headless');
    await client.detect({ installDir: 'packages/api' });
    expect(hooks.detect).toHaveBeenCalledWith({
      installDir: path.join(store.session.installDir, 'packages/api'),
    });
  });

  it('commits credentials through the hook, leaks nothing, and shuts down once', async () => {
    const { client, hooks } = await serve('tui');
    const state = await client.setCredentials();
    expect(hooks.setCredentials).toHaveBeenCalledTimes(1);
    expect(state.session).toMatchObject({ hasCredentials: true, projectId: 7 });
    expectNoSecrets(JSON.stringify(state));

    await client.shutdown();
    await client.shutdown();
    await settle(10);
    expect(hooks.shutdown).toHaveBeenCalledTimes(1);
  });

  it('refuses to resolve credentials for a session without an API key', async () => {
    const { client, hooks } = await serve('tui', Program.PostHogIntegration, {
      apiKey: null,
    });
    await expect(client.setCredentials()).rejects.toMatchObject({
      status: 400,
    });
    expect(hooks.setCredentials).not.toHaveBeenCalled();
  });

  it('surfaces a hook failure as 500 with its message', async () => {
    const { client, hooks } = await serve('tui');
    vi.mocked(hooks.setCredentials).mockRejectedValueOnce(new Error('no key'));
    await expect(client.setCredentials()).rejects.toEqual(
      new ControlClientError(500, 'no key'),
    );
  });
});
