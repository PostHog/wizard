import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'node:path';
import { PROGRAM_REGISTRY } from '@programs';
import type { ProgramId } from '@programs/types';
import { logToFile } from '@utils/debug';
import {
  BadParamError,
  MissingParamError,
  optionalFlag,
  optionalRecord,
  optionalString,
  optionalStringList,
} from '@shared/control/params';
import { RunInFlightError, RunLedger } from './runs';
import type {
  ControlHooks,
  ControlMode,
  ControlState,
  ControlSurface,
  ControlTarget,
  ControlWrite,
  DetectRequest,
  HealthResponse,
  RunConfigOverlay,
  RunRequest,
  SetterView,
} from '@shared/control/types';

/** Appears in exactly one built chunk, so bundle checks can find the server. */
export const CONTROL_SERVER_MARKER = 'wizard-control-server';

export const MAX_BODY_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 200;
/** Long polls cap here so a stuck parent never pins a connection forever. */
const MAX_WAIT_MS = 600_000;
/** The state keeps the most recent raw setter calls, not an unbounded log. */
const MAX_CONTROL_WRITES = 100;

/** Every route the server answers; the headless README table is checked against it. */
export const ROUTES = [
  'GET /health',
  'GET /state',
  'GET /runs',
  'GET /store',
  'POST /actions/:id',
  'POST /store/:setter',
  'POST /credentials',
  'POST /detect',
  'POST /runs',
  'POST /shutdown',
] as const;

export interface ControlServerOptions {
  socketPath: string;
  surface: ControlSurface;
  mode: ControlMode;
  hooks: ControlHooks;
  version: string;
  program: string;
}

export interface ControlServerHandle {
  readonly socketPath: string;
  readonly ledger: RunLedger;
  close(): Promise<void>;
}

/** Thrown when an action is not legal on the current screen. Maps to 400. */
export class UnknownActionError extends Error {
  constructor(action: string, screen: string | null) {
    super(
      `No action "${action}" on screen "${screen ?? 'none'}". ` +
        'Read state.actions first.',
    );
    this.name = 'UnknownActionError';
  }
}

/** Thrown for a setter name outside the table. Maps to 400. */
export class UnknownSetterError extends Error {
  constructor(name: string) {
    super(`No store setter "${name}". Read GET /store for the list.`);
    this.name = 'UnknownSetterError';
  }
}

/** A route this surface or mode does not offer. Maps to 403 or 501. */
class RouteUnavailableError extends Error {
  constructor(message: string, readonly status: 403 | 501) {
    super(message);
    this.name = 'RouteUnavailableError';
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
  if (err instanceof RouteUnavailableError) return err.status;
  if (
    err instanceof UnknownActionError ||
    err instanceof UnknownSetterError ||
    err instanceof MissingParamError ||
    err instanceof BadParamError
  ) {
    return 400;
  }
  if (err instanceof RunInFlightError) return 409;
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

/** A request's install dir, resolved against the session's; absent keeps it. */
function resolveInstallDir(
  base: string,
  requested: string | undefined,
): string {
  return requested ? path.resolve(base, requested) : base;
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

function pathParam(pathname: string, prefix: string): string | null {
  const match = new RegExp(`^/${prefix}/([^/]+)$`).exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    throw new HttpError(400, `${prefix} name is not valid percent-encoding`);
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
  target: ControlTarget,
  options: ControlServerOptions,
): Promise<ControlServerHandle> {
  const { socketPath, surface, mode, hooks } = options;
  const ledger = new RunLedger();
  const polls = new AbortController();
  const writes: ControlWrite[] = [];
  let shuttingDown = false;

  const readState = (): ControlState => ({
    ...target.readState(),
    mode,
    actions: target.actions().map(({ id, description, params }) => ({
      id,
      description,
      ...(params ? { params } : {}),
    })),
    controlWrites: [...writes],
  });

  const setterViews = (): SetterView[] =>
    target.setters().map(({ name, description, params }) => ({
      name,
      description,
      ...(params ? { params } : {}),
    }));

  const waitForVersion = (
    since: number,
    timeoutMs: number,
  ): Promise<ControlState> => {
    if (target.version() > since || polls.signal.aborted) {
      return Promise.resolve(readState());
    }
    return new Promise<ControlState>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsub();
        polls.signal.removeEventListener('abort', finish);
        resolve(readState());
      };
      const timer = setTimeout(finish, timeoutMs);
      const unsub = target.subscribe(() => {
        if (target.version() > since) finish();
      });
      polls.signal.addEventListener('abort', finish, { once: true });
    });
  };

  /** Routes that rewrite the session or end the process wait for the run to end. */
  const requireIdle = (): void => {
    const active = ledger.active;
    if (active) throw new RunInFlightError(active.runId);
    if (target.runInFlight()) throw new RunInFlightError();
  };

  const startRun = (body: Record<string, unknown>) => {
    const route = 'POST /runs';
    if (!hooks.startRun) {
      throw new RouteUnavailableError(
        `${route} is not available on the ${surface} surface`,
        501,
      );
    }
    const frameworkContext = optionalRecord(route, body, 'frameworkContext');
    const skillId = optionalString(route, body, 'skillId');
    const installDir = resolveInstallDir(
      target.installDir(),
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
    Promise.resolve()
      .then(() => hooks.startRun?.(req))
      .then(
        () => ledger.finish(record.runId, readState()),
        (err: unknown) =>
          ledger.fail(
            record.runId,
            err instanceof Error ? err.message : String(err),
            readState(),
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
        mode,
        pid: process.pid,
        program: options.program,
      };
      return send(res, 200, health);
    }
    if (route === 'GET /state') {
      const wait = Number(url.searchParams.get('wait') ?? '');
      const since = Number(url.searchParams.get('since') ?? '');
      const state =
        Number.isFinite(wait) && wait > 0
          ? await waitForVersion(
              Number.isFinite(since) ? since : target.version(),
              Math.min(wait, MAX_WAIT_MS),
            )
          : readState();
      return send(res, 200, { ok: true, state });
    }
    if (route === 'GET /runs') {
      return send(res, 200, { ok: true, runs: ledger.list() });
    }
    if (route === 'GET /store') {
      // Discoverable in either mode; only full control may call them.
      return send(res, 200, { ok: true, mode, setters: setterViews() });
    }
    if (method !== 'POST') throw new HttpError(404, `no route ${route}`);

    const body = await readBody(req);
    const action = pathParam(url.pathname, 'actions');
    if (action !== null) {
      const params = optionalRecord(route, body, 'params') ?? {};
      const found = target.actions().find((a) => a.id === action);
      if (!found) {
        throw new UnknownActionError(action, target.readState().currentScreen);
      }
      found.apply(params);
      return send(res, 200, { ok: true, state: readState() });
    }
    const setter = pathParam(url.pathname, 'store');
    if (setter !== null) {
      if (mode !== 'full') {
        throw new RouteUnavailableError(
          'POST /store/:setter needs --full-control; partial control acts only through POST /actions/:id',
          403,
        );
      }
      const params = optionalRecord(route, body, 'params') ?? {};
      const found = target.setters().find((s) => s.name === setter);
      if (!found) throw new UnknownSetterError(setter);
      found.apply(params);
      writes.push({ setter, at: new Date().toISOString() });
      if (writes.length > MAX_CONTROL_WRITES) writes.shift();
      return send(res, 200, { ok: true, state: readState() });
    }
    switch (url.pathname) {
      case '/credentials':
        requireIdle();
        if (!target.hasApiKey()) {
          throw new HttpError(400, 'this session has no API key to resolve');
        }
        await hooks.setCredentials();
        return send(res, 200, { ok: true, state: readState() });
      case '/detect': {
        if (!hooks.detect) {
          throw new RouteUnavailableError(
            `${route} is not available on the ${surface} surface`,
            501,
          );
        }
        requireIdle();
        const installDir = optionalString(route, body, 'installDir');
        const detect: DetectRequest = {
          ...(body.programId !== undefined
            ? { programId: requireProgram(body.programId) }
            : {}),
          ...(installDir
            ? { installDir: resolveInstallDir(target.installDir(), installDir) }
            : {}),
        };
        await hooks.detect(detect);
        return send(res, 200, { ok: true, state: readState() });
      }
      case '/runs':
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
        logToFile(
          `[control] ${req.method ?? 'GET'} ${req.url ?? '/'} failed:`,
          err,
        );
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
    `[control] listening on ${socketPath} (${surface}, ${mode}) ${CONTROL_SERVER_MARKER}`,
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
