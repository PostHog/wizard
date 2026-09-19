import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Program } from '../../programs/program-registry.js';
import {
  buildSession,
  OutroKind,
  RunPhase,
} from '../../session/wizard-session.js';
import { createTestStore } from '../../testing/index.js';
import { setUI } from '../../ui/index.js';
import { StoreUI } from '../../ui/store-ui.js';
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
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

function socketDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wz-ctl-'));
  dirs.push(dir);
  return dir;
}

async function serve(
  surface: ControlSurface = 'headless',
  program = Program.PostHogIntegration,
) {
  const store = createTestStore(program);
  setUI(new StoreUI(store));
  store.session = buildSession({ installDir: '/tmp/control-server', ci: true });
  const hooks: ControlHooks = {
    setCredentials: vi.fn(() => {
      store.setCredentials({
        accessToken: 'phx_SECRET',
        projectApiKey: 'phc_TOKEN',
        host: {} as never,
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
      await new Promise((r) => setTimeout(r, 30));
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

describe('control server', () => {
  it('answers health with the surface and program', async () => {
    const { client } = await serve('tui', Program.Audit);
    expect(await client.health()).toMatchObject({
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

  it('maps bad input to 400, unknown routes to 404', async () => {
    const { client, socketPath } = await serve();
    await expect(client.performAction('keep_skills')).rejects.toMatchObject({
      status: 400,
    });
    expect((await raw(socketPath, 'GET', '/nope')).status).toBe(404);
    expect(
      (
        await raw(socketPath, 'POST', '/nope', '{}', {
          'content-type': 'application/json',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await raw(socketPath, 'POST', '/actions/confirm_setup', '{', {
          'content-type': 'application/json',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await raw(socketPath, 'POST', '/runs', '{}', {
          'content-type': 'application/json',
        })
      ).status,
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
      host: {} as never,
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

  it('caps the body and requires JSON', async () => {
    const { socketPath } = await serve();
    const big = JSON.stringify({
      params: { pad: 'x'.repeat(MAX_BODY_BYTES + 1) },
    });
    const r = await raw(socketPath, 'POST', '/actions/confirm_setup', big, {
      'content-type': 'application/json',
    }).catch(() => ({ status: 413, json: {} }));
    expect(r.status).toBe(413);
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

  it('owns its socket: 0600, stale files replaced, live sockets refused, unlinked on close', async () => {
    const dir = socketDir();
    const stale = path.join(dir, 'stale.sock');
    fs.writeFileSync(stale, '');
    const store = createTestStore();
    setUI(new StoreUI(store));
    const hooks = {
      setCredentials: vi.fn(),
      detect: vi.fn(),
      startRun: vi.fn(),
      shutdown: vi.fn(),
    } as unknown as ControlHooks;
    const handle = await attachControlServer(store, {
      socketPath: stale,
      surface: 'tui',
      hooks,
      version: 't',
      program: 'p',
    });
    expect(fs.statSync(stale).mode & 0o777).toBe(0o600);
    expect((await new ControlClient(stale).health()).ok).toBe(true);

    const live = path.join(dir, 'live.sock');
    const other = net.createServer().listen(live);
    await new Promise((r) => other.once('listening', r));
    await expect(
      attachControlServer(store, {
        socketPath: live,
        surface: 'tui',
        hooks,
        version: 't',
        program: 'p',
      }),
    ).rejects.toThrow(/already served/);
    other.close();

    await handle.close();
    expect(fs.existsSync(stale)).toBe(false);
  });

  it('runs one independent run at a time and records it in the ledger', async () => {
    const { client, hooks } = await serve('headless');
    const run = await client.startRun({
      programId: Program.PostHogIntegration,
      installDir: '/tmp/app',
    });
    expect(run).toMatchObject({
      status: 'running',
      programId: Program.PostHogIntegration,
      installDir: '/tmp/app',
    });
    expect(hooks.startRun).toHaveBeenCalledWith({
      programId: Program.PostHogIntegration,
      installDir: '/tmp/app',
    });
    await expect(
      client.startRun({ programId: Program.PostHogIntegration }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await client.state()).session.runPhase).toBe(RunPhase.Running);

    await new Promise((r) => setTimeout(r, 80));
    const runs = await client.runs();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      runId: run.runId,
      status: 'done',
      error: null,
    });
    // The result is the state as it read when the run ended.
    expect(runs[0].result?.session).toMatchObject({
      runPhase: RunPhase.Completed,
      outroData: { kind: OutroKind.Success, message: 'done' },
    });
    expect(runs[0].finishedAt).not.toBeNull();
    expect((await client.state()).session.runPhase).toBe(RunPhase.Completed);
  });

  it('records a failed run with its error', async () => {
    const { client, hooks } = await serve('headless');
    vi.mocked(hooks.startRun).mockRejectedValueOnce(
      new Error('gateway refused'),
    );
    await client.startRun({ programId: Program.PostHogIntegration });
    await new Promise((r) => setTimeout(r, 20));
    const [record] = await client.runs();
    expect(record).toMatchObject({
      status: 'failed',
      error: 'gateway refused',
    });
    expect(record.result?.currentScreen).toBe('intro');
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

  it('commits credentials through the hook and shuts down once', async () => {
    const { client, hooks } = await serve('tui');
    const state = await client.setCredentials();
    expect(hooks.setCredentials).toHaveBeenCalledTimes(1);
    expect(state.session).toMatchObject({ hasCredentials: true, projectId: 7 });
    expect(JSON.stringify(state)).not.toContain('phx_SECRET');

    await client.shutdown();
    await client.shutdown();
    await new Promise((r) => setTimeout(r, 10));
    expect(hooks.shutdown).toHaveBeenCalledTimes(1);
  });

  it('surfaces a hook failure as 500 with its message', async () => {
    const { client, hooks } = await serve('tui');
    vi.mocked(hooks.setCredentials).mockRejectedValueOnce(new Error('no key'));
    await expect(client.setCredentials()).rejects.toEqual(
      new ControlClientError(500, 'no key'),
    );
  });
});
