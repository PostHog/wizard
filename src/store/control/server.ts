import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import {
  PROGRAM_REGISTRY,
  type ProgramId,
} from '../programs/program-registry.js';
import { RunPhase } from '../session/wizard-session.js';
import { logToFile } from '../shared/debug.js';
import { resolveInstallDir } from '../shared/paths.js';
import type { FlowStore } from '../state/store.js';
import { UnknownActionError } from './actions.js';
import { ControlDriver } from './driver.js';
import { CONTROL_SERVER_MARKER } from './marker.js';
import {
  BadParamError,
  MissingParamError,
  optionalFlag,
  optionalRecord,
  optionalString,
  optionalStringList,
} from './params.js';
import { RunInFlightError, RunLedger } from './runs.js';
import { UnknownSetterError } from './setters.js';
import type {
  ControlHooks,
  ControlState,
  ControlSurface,
  DetectRequest,
  HealthResponse,
  RunConfigOverlay,
  RunRequest,
} from './types.js';

export const MAX_BODY_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 200;
/** Long polls cap here so a stuck parent never pins a connection forever. */
const MAX_WAIT_MS = 600_000;

/** Every route the server answers; the docs table is checked against it. */
export const ROUTES = [
  'GET /health',
  'GET /state',
  'GET /runs',
  'GET /store',
  'POST /actions/:id',
  'POST /store/:setter',
  'POST /credentials',
  'POST /run',
  'POST /detect',
  'POST /runs',
  'POST /shutdown',
] as const;

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
    err instanceof UnknownSetterError ||
    err instanceof MissingParamError ||
    err instanceof BadParamError
  ) {
    return 400;
  }
  if (err instanceof RunInFlightError) return 409;
  if (err instanceof SurfaceUnavailableError) return 501;
  return 500;
}

function requireProgram(programId: unknown): ProgramId {
  if (typeof programId !== 'string' || !programId) {
    throw new HttpError(400, 'programId is required');
  }
  if (!PROGRAM_REGISTRY.some((c) => c.id === programId)) {
    throw new HttpError(400, `unknown program "${programId}"`);
  }
  return programId;
}

/** Refuse a live socket or a non-socket path; unlink a stale socket. */
async function claimSocketPath(socketPath: string): Promise<void> {
  if (!fs.existsSync(socketPath)) return;
  if (!fs.lstatSync(socketPath).isSocket()) {
    throw new Error(`control socket path is not a socket: ${socketPath}`);
  }
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
        // Stop reading but keep the connection: the 413 still has to go out.
        req.pause();
        reject(new HttpError(413, `body over ${MAX_BODY_BYTES} bytes`));
      } else {
        chunks.push(chunk);
      }
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
        ) {
          throw new Error('not an object');
        }
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

function actionId(pathname: string): string | null {
  const match = /^\/actions\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    throw new HttpError(400, 'action id is not valid percent-encoding');
  }
}

function setterName(pathname: string): string | null {
  const match = /^\/store\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    throw new HttpError(400, 'setter name is not valid percent-encoding');
  }
}

const RUN_CONFIG_KEYS = [
  'agentFlow',
  'allowedTools',
  'disallowedTools',
  'requiresAi',
  'reportFile',
  'eventPlanFile',
  'streamWorkflowId',
] as const satisfies readonly (keyof RunConfigOverlay)[];

/** The `config` overlay of a run request: every key known, every value the field's type. */
function readRunConfig(
  route: string,
  body: Record<string, unknown>,
): RunConfigOverlay | undefined {
  const raw = optionalRecord(route, body, 'config');
  if (!raw) return undefined;
  for (const key of Object.keys(raw)) {
    if (!(RUN_CONFIG_KEYS as readonly string[]).includes(key)) {
      throw new BadParamError(
        route,
        'config',
        `unknown key "${key}"; allowed: ${RUN_CONFIG_KEYS.join(', ')}`,
      );
    }
  }
  const subject = `${route} config`;
  const config: RunConfigOverlay = {};
  for (const key of [
    'agentFlow',
    'reportFile',
    'eventPlanFile',
    'streamWorkflowId',
  ] as const) {
    const value = optionalString(subject, raw, key);
    if (value !== undefined) config[key] = value;
  }
  for (const key of ['allowedTools', 'disallowedTools'] as const) {
    const value = optionalStringList(subject, raw, key);
    if (value !== undefined) config[key] = value;
  }
  const requiresAi = optionalFlag(subject, raw, 'requiresAi');
  if (requiresAi !== undefined) config.requiresAi = requiresAi;
  return config;
}

/** Serve the control API for one store over a unix socket: HTTP/1.1, JSON in and out. */
export async function attachControlServer(
  store: FlowStore,
  options: ControlServerOptions,
): Promise<ControlServerHandle> {
  const { socketPath, surface, hooks } = options;
  const ledger = new RunLedger();
  const driver = new ControlDriver(store);
  const polls = new AbortController();
  let shuttingDown = false;

  const requireSurface = (route: string, wanted: ControlSurface): void => {
    if (surface !== wanted) throw new SurfaceUnavailableError(route, surface);
  };

  /** Routes that rewrite the session or end the process wait for the run to end. */
  const requireIdle = (): void => {
    const active = ledger.active;
    if (active) throw new RunInFlightError(active.runId);
    if (store.session.runPhase === RunPhase.Running) {
      throw new RunInFlightError();
    }
  };

  const startRun = (body: Record<string, unknown>) => {
    const route = 'POST /runs';
    const frameworkContext = optionalRecord(route, body, 'frameworkContext');
    const skillId = optionalString(route, body, 'skillId');
    const installDir = resolveInstallDir(
      store.session.installDir,
      optionalString(route, body, 'installDir'),
    );
    const config = readRunConfig(route, body);
    const req: RunRequest = {
      // A skill alone runs on the generic skill program.
      programId: requireProgram(
        body.programId ?? (skillId ? 'agent-skill' : undefined),
      ),
      installDir,
      ...(frameworkContext ? { frameworkContext } : {}),
      ...(skillId ? { skillId } : {}),
      ...(config ? { config } : {}),
    };
    const record = ledger.start(req.programId, installDir, skillId ?? null);
    // The state keeps this run's outcome until the next run starts; the hook
    // resets it then, so a poller reading after completion sees the result.
    Promise.resolve()
      .then(() => hooks.startRun(req))
      .then(
        () => ledger.finish(record.runId, driver.readState()),
        (err: unknown) =>
          ledger.fail(
            record.runId,
            err instanceof Error ? err.message : String(err),
            driver.readState(),
          ),
      )
      .catch((err: unknown) =>
        logToFile('[control] ledger update failed:', err),
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
      const health: HealthResponse = {
        ok: true,
        version: options.version,
        surface,
        pid: process.pid,
        program: options.program,
      };
      return send(res, 200, health);
    }
    if (route === 'GET /state') {
      const wait = Number(url.searchParams.get('wait') ?? '');
      const since = Number(url.searchParams.get('since') ?? '');
      let state: ControlState;
      if (Number.isFinite(wait) && wait > 0) {
        const from = Number.isFinite(since) ? since : store.getVersion();
        state = await driver.waitForVersion(
          from,
          Math.min(wait, MAX_WAIT_MS),
          polls.signal,
        );
      } else {
        state = driver.readState();
      }
      return send(res, 200, { ok: true, state });
    }
    if (route === 'GET /runs') {
      return send(res, 200, { ok: true, runs: ledger.list() });
    }
    if (route === 'GET /store') {
      return send(res, 200, { ok: true, setters: driver.setters() });
    }
    if (method !== 'POST') throw new HttpError(404, `no route ${route}`);

    const body = await readBody(req);
    const action = actionId(url.pathname);
    if (action !== null) {
      const params = optionalRecord(route, body, 'params') ?? {};
      return send(res, 200, {
        ok: true,
        state: driver.performAction(action, params),
      });
    }
    const setter = setterName(url.pathname);
    if (setter !== null) {
      const params = optionalRecord(route, body, 'params') ?? {};
      return send(res, 200, {
        ok: true,
        state: driver.applySetter(setter, params),
      });
    }
    switch (url.pathname) {
      case '/credentials':
        requireIdle();
        if (!store.session.apiKey) {
          throw new HttpError(400, 'this session has no API key to resolve');
        }
        await hooks.setCredentials();
        return send(res, 200, { ok: true, state: driver.readState() });
      case '/run':
        requireSurface(route, 'tui');
        store.requestRun();
        return send(res, 200, { ok: true, state: driver.readState() });
      case '/detect': {
        requireSurface(route, 'headless');
        requireIdle();
        const installDir = optionalString(route, body, 'installDir');
        const detect: DetectRequest = {
          ...(body.programId !== undefined
            ? { programId: requireProgram(body.programId) }
            : {}),
          ...(installDir
            ? {
                installDir: resolveInstallDir(
                  store.session.installDir,
                  installDir,
                ),
              }
            : {}),
        };
        await hooks.detect(detect);
        return send(res, 200, { ok: true, state: driver.readState() });
      }
      case '/runs':
        requireSurface(route, 'headless');
        return send(res, 200, { ok: true, run: startRun(body) });
      case '/shutdown':
        requireIdle();
        send(res, 200, { ok: true });
        if (!shuttingDown) {
          shuttingDown = true;
          res.once('finish', () => {
            hooks
              .shutdown()
              .catch((err: unknown) =>
                logToFile('[control] shutdown hook failed:', err),
              );
          });
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
      if (status === 500) {
        logToFile(`[control] ${describeRequest(req)} failed:`, err);
      }
      if (res.headersSent) {
        res.end();
        return;
      }
      if (status === 413) {
        // The unread body would stall this connection; close it after the reply.
        res.setHeader('connection', 'close');
        res.once('finish', () => req.destroy());
      }
      send(res, status, { ok: false, error: message });
    });
  });
  server.keepAliveTimeout = 1000;

  await claimSocketPath(socketPath);
  // Listen with a tight umask so the socket never exists with wider permissions.
  const previousUmask = process.umask(0o077);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } finally {
    process.umask(previousUmask);
  }
  fs.chmodSync(socketPath, 0o600);
  logToFile(
    `[control] listening on ${socketPath} (${surface}) ${CONTROL_SERVER_MARKER}`,
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
    close: async () => {
      if (closed) return;
      closed = true;
      process.off('exit', onExit);
      unlink();
      // Aborted long polls answer first; idle keep-alive connections are swept until none remain.
      polls.abort();
      await new Promise<void>((resolve) => setImmediate(resolve));
      const sweep = setInterval(() => server.closeIdleConnections(), 10);
      const forced = setTimeout(() => server.closeAllConnections(), 1000);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      clearInterval(sweep);
      clearTimeout(forced);
    },
  };
}

function describeRequest(req: http.IncomingMessage): string {
  return `${req.method ?? 'GET'} ${req.url ?? '/'}`;
}
