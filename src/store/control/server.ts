import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import { PROGRAM_REGISTRY } from '../programs/program-registry.js';
import { RunPhase } from '../session/wizard-session.js';
import { logToFile } from '../shared/debug.js';
import type { WizardStore } from '../state/store.js';
import {
  BadParamError,
  MissingParamError,
  UnknownActionError,
} from './actions.js';
import { ControlDriver } from './driver.js';
import { CONTROL_SERVER_MARKER } from './marker.js';
import { RunInFlightError, RunLedger } from './runs.js';
import { runResult } from './state.js';
import type {
  ControlHooks,
  ControlState,
  ControlSurface,
  DetectRequest,
  RunRequest,
  RunStatus,
} from './types.js';

export const MAX_BODY_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 200;
/** Long polls cap here so a stuck parent never pins a connection forever. */
const MAX_WAIT_MS = 10 * 60 * 1000;

export interface ControlServerOptions {
  socketPath: string;
  surface: ControlSurface;
  hooks: ControlHooks;
  version: string;
  program: string;
}

export interface ControlServerHandle {
  readonly socketPath: string;
  readonly ledger: RunLedger;
  close(): Promise<void>;
}

/** A hook the other surface owns. Maps to 501. */
class SurfaceUnavailableError extends Error {
  constructor(route: string, surface: ControlSurface) {
    super(`${route} is not available on the ${surface} surface`);
    this.name = 'SurfaceUnavailableError';
  }
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

function statusFor(err: unknown): number {
  if (err instanceof HttpError) return err.status;
  if (
    err instanceof UnknownActionError ||
    err instanceof MissingParamError ||
    err instanceof BadParamError
  )
    return 400;
  if (err instanceof RunInFlightError) return 409;
  if (err instanceof SurfaceUnavailableError) return 501;
  return 500;
}

function requireProgram(programId: string): void {
  if (!PROGRAM_REGISTRY.some((c) => c.id === programId))
    throw new HttpError(400, `unknown program "${programId}"`);
}

/** Refuse a live socket; unlink a stale file. */
async function claimSocketPath(socketPath: string): Promise<void> {
  if (!fs.existsSync(socketPath)) return;
  const live = await new Promise<boolean>((resolve) => {
    const probe = net.connect(socketPath);
    const done = (value: boolean): void => {
      probe.destroy();
      resolve(value);
    };
    probe.setTimeout(PROBE_TIMEOUT_MS, () => done(true));
    probe.once('connect', () => done(true));
    probe.once('error', () => done(false));
  });
  if (live) throw new Error(`control socket already served: ${socketPath}`);
  fs.unlinkSync(socketPath);
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const type = req.headers['content-type'];
    if (type && !type.toLowerCase().startsWith('application/json')) {
      reject(new HttpError(415, 'body must be application/json'));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, `body over ${MAX_BODY_BYTES} bytes`));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return resolve({});
      try {
        const parsed: unknown = JSON.parse(text);
        if (
          parsed === null ||
          typeof parsed !== 'object' ||
          Array.isArray(parsed)
        )
          throw new Error('not an object');
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new HttpError(400, 'body is not a JSON object'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

/**
 * Serve the control API for one store over a unix socket. HTTP/1.1, JSON in
 * and out. The store never learns who is listening; the hooks do the work the
 * composition root owns.
 */
export async function attachControlServer(
  store: WizardStore,
  options: ControlServerOptions,
): Promise<ControlServerHandle> {
  const { socketPath, surface, hooks } = options;
  const ledger = new RunLedger();
  let shuttingDown = false;

  const runStatus = (): { status: RunStatus; error: string | null } => {
    const active = ledger.active;
    if (active) return { status: 'running', error: null };
    const last = ledger.list().at(-1);
    if (last) return { status: last.status, error: last.error };
    switch (store.session.runPhase) {
      case RunPhase.Running:
        return { status: 'running', error: null };
      case RunPhase.Completed:
        return { status: 'done', error: null };
      case RunPhase.Error:
        return {
          status: 'failed',
          error: store.session.outroData?.message ?? null,
        };
      default:
        return {
          status: store.session.runRequested ? 'running' : 'idle',
          error: null,
        };
    }
  };
  const driver = new ControlDriver(store, runStatus);

  const requireSurface = (route: string, wanted: ControlSurface): void => {
    if (surface !== wanted) throw new SurfaceUnavailableError(route, surface);
  };

  const startRun = (body: Record<string, unknown>) => {
    const programId = body.programId;
    if (typeof programId !== 'string' || !programId)
      throw new HttpError(400, 'programId is required');
    requireProgram(programId);
    const req: RunRequest = {
      programId,
      ...(typeof body.installDir === 'string'
        ? { installDir: body.installDir }
        : {}),
      ...(body.frameworkContext &&
      typeof body.frameworkContext === 'object' &&
      !Array.isArray(body.frameworkContext)
        ? { frameworkContext: body.frameworkContext as Record<string, unknown> }
        : {}),
      ...(typeof body.skillId === 'string' ? { skillId: body.skillId } : {}),
    };
    const record = ledger.start(
      programId,
      req.installDir ?? store.session.installDir,
    );
    // The state keeps this run's outcome until the next run starts; the hook
    // resets it then, so a poller reading after completion sees the result.
    void hooks.startRun(req).then(
      () => ledger.finish(record.runId, runResult(store)),
      (err: unknown) =>
        ledger.fail(
          record.runId,
          err instanceof Error ? err.message : String(err),
          runResult(store),
        ),
    );
    return { ...record };
  };

  const handle = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://control');
    const method = req.method ?? 'GET';
    const route = `${method} ${url.pathname}`;

    if (route === 'GET /health') {
      return send(res, 200, {
        ok: true,
        version: options.version,
        surface,
        pid: process.pid,
        program: options.program,
      });
    }
    if (route === 'GET /state') {
      const wait = Number(url.searchParams.get('wait') ?? '');
      const since = Number(url.searchParams.get('since') ?? '');
      let state: ControlState;
      if (Number.isFinite(wait) && wait > 0) {
        const from = Number.isFinite(since) ? since : store.getVersion();
        state = await driver.waitForVersion(from, Math.min(wait, MAX_WAIT_MS));
      } else state = driver.readState();
      return send(res, 200, { ok: true, state });
    }
    if (route === 'GET /runs')
      return send(res, 200, { ok: true, runs: ledger.list() });
    if (method !== 'POST') throw new HttpError(404, `no route ${route}`);

    const body = await readBody(req);
    const actionMatch = /^\/actions\/([^/]+)$/.exec(url.pathname);
    if (actionMatch) {
      const params =
        body.params && typeof body.params === 'object'
          ? (body.params as Record<string, unknown>)
          : {};
      const state = driver.performAction(
        decodeURIComponent(actionMatch[1]),
        params,
      );
      return send(res, 200, { ok: true, state });
    }
    switch (url.pathname) {
      case '/credentials':
        await hooks.setCredentials();
        return send(res, 200, { ok: true, state: driver.readState() });
      case '/run':
        requireSurface('POST /run', 'tui');
        hooks.armRun();
        return send(res, 200, { ok: true, run: runStatus() });
      case '/detect': {
        requireSurface('POST /detect', 'headless');
        if (typeof body.programId === 'string') requireProgram(body.programId);
        const detect: DetectRequest = {
          ...(typeof body.programId === 'string'
            ? { programId: body.programId }
            : {}),
          ...(typeof body.installDir === 'string'
            ? { installDir: body.installDir }
            : {}),
        };
        await hooks.detect(detect);
        return send(res, 200, { ok: true, state: driver.readState() });
      }
      case '/runs':
        requireSurface('POST /runs', 'headless');
        return send(res, 200, { ok: true, run: startRun(body) });
      case '/shutdown':
        send(res, 200, { ok: true });
        if (!shuttingDown) {
          shuttingDown = true;
          res.once('finish', () => void hooks.shutdown());
        }
        return;
      default:
        throw new HttpError(404, `no route ${route}`);
    }
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      const status = statusFor(err);
      const message = err instanceof Error ? err.message : String(err);
      if (status === 500)
        logToFile(`[${CONTROL_SERVER_MARKER}] ${route(req)} failed:`, err);
      if (!res.headersSent) send(res, status, { ok: false, error: message });
      else res.end();
    });
  });
  server.keepAliveTimeout = 1000;

  await claimSocketPath(socketPath);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });
  fs.chmodSync(socketPath, 0o600);
  logToFile(
    `[${CONTROL_SERVER_MARKER}] listening on ${socketPath} (${surface})`,
  );

  let closed = false;
  const unlink = (): void => {
    try {
      fs.unlinkSync(socketPath);
    } catch {
      /* already gone */
    }
  };
  const onExit = (): void => {
    if (!closed) unlink();
  };
  process.once('exit', onExit);

  return {
    socketPath,
    ledger,
    close: () =>
      new Promise<void>((resolve) => {
        if (closed) return resolve();
        closed = true;
        process.off('exit', onExit);
        server.closeAllConnections();
        server.close(() => {
          unlink();
          resolve();
        });
      }),
  };
}

function route(req: http.IncomingMessage): string {
  return `${req.method ?? 'GET'} ${req.url ?? '/'}`;
}
