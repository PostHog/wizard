import { randomUUID } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { validate as isUUID } from 'uuid';
import { valid as validVersion } from 'semver';
import { VERSION } from '@shared/version';
import {
  RunPhase,
  type Credentials,
  type WizardSession,
} from '@lib/wizard-session';
import { currentCredentials } from '@shared/oauth-session';
import { isGrantRevoked } from '@shared/auth-session-state';
import { logToFile } from '@utils/debug';
import { parseRetryAfter } from './destinations/posthog';

export type RunOutcome = 'completed' | 'failed' | 'cancelled';
type RunTask = {
  name: string;
  status: 'created' | 'running' | 'completed' | 'failed';
};
// The task fields a snapshot reads, local so task-stream stays off the TUI store.
type TaskItem = {
  id?: string;
  source?: string;
  sourceStatus?: string;
  label: string;
  status: string;
};
type Options = {
  mode: 'local' | 'cloud';
  programId: string;
  assignedId?: string;
  getSession: () => WizardSession;
  fetchImpl?: typeof fetch;
  onError?: (message: string) => void;
};

const STATUS: Record<string, RunTask['status']> = {
  pending: 'created',
  in_progress: 'running',
  completed: 'completed',
  failed: 'failed',
  skipped: 'completed',
};

export class RunTaskNames {
  private names = new Map<string, string>();
  private used = new Set<string>();

  snapshot(items: readonly TaskItem[]): RunTask[] {
    if (items.length > 100) throw new Error('task limit exceeded (100)');
    const occurrences = new Map<string, number>();
    const ids = new Set<string>();
    return items.map((item) => {
      const subject = item.label.trim();
      if (!subject) throw new Error('blank task name');
      const rawStatus = item.sourceStatus ?? item.status;
      const status = STATUS[rawStatus];
      if (!Object.hasOwn(STATUS, rawStatus))
        throw new Error('invalid task status');
      const occurrence = (occurrences.get(subject) ?? 0) + 1;
      occurrences.set(subject, occurrence);
      const id = item.id
        ? JSON.stringify([item.source, item.id])
        : JSON.stringify([subject, occurrence]);
      if (ids.has(id)) throw new Error('duplicate task identity');
      ids.add(id);
      let name = this.names.get(id);
      if (!name) {
        name = subject.slice(0, 255);
        for (let n = 2; this.used.has(name); n++) {
          const suffix = ` (${n})`;
          name = subject.slice(0, 255 - suffix.length) + suffix;
        }
        this.names.set(id, name);
        this.used.add(name);
      }
      return { name, status };
    });
  }
}

export function createWizardRunSync(
  options: Omit<Options, 'mode'> & {
    mode: 'local' | 'headless' | 'ci';
    noTelemetry: boolean;
  },
): WizardRunSync | undefined {
  if (options.noTelemetry || options.mode === 'ci') return;
  if (options.mode === 'headless' && options.assignedId === undefined) return;
  return new WizardRunSync({
    ...options,
    mode: options.assignedId !== undefined ? 'cloud' : 'local',
  });
}

export class WizardRunSync {
  private readonly names = new RunTaskNames();
  private readonly tasksAbort = new AbortController();
  private readonly reported = new Set<string>();
  private context?: {
    apiHost: string;
    projectId: number;
    programId: string;
    mode: Options['mode'];
    id?: string;
  };
  private queue: Promise<void> = Promise.resolve();
  private lastBody?: string;
  private stopped = false;
  private tasksDisabled = false;
  private authDisabled = false;
  private closing?: Promise<void>;

  constructor(private readonly options: Options) {}

  capture(items: readonly TaskItem[] | undefined): void {
    if (this.stopped || this.tasksDisabled || !items) return;
    if (
      this.options.mode === 'cloud' &&
      !isUUID(this.options.assignedId ?? '')
    ) {
      this.tasksDisabled = true;
      this.report('invalid cloud run assignment');
      return;
    }
    const session = this.options.getSession();
    if (session.runPhase === RunPhase.Idle) return;
    if (!this.context) {
      if (session.runPhase !== RunPhase.Running || !session.credentials) return;
      const { host, projectId } = session.credentials;
      this.context = {
        apiHost: host.appHost.replace(/\/$/, ''),
        projectId,
        programId: this.options.programId,
        mode: this.options.mode,
        id: this.options.assignedId,
      };
      this.queue = this.initialize(session);
    }
    try {
      const body = JSON.stringify({ tasks: this.names.snapshot(items) });
      if (body === this.lastBody) return;
      this.lastBody = body;
      this.queue = this.queue.then(async () => {
        if (
          this.tasksDisabled ||
          this.tasksAbort.signal.aborted ||
          !this.context?.id
        )
          return;
        const ok = await this.request(
          'PUT',
          `${this.context.id}/tasks/`,
          body,
          this.tasksAbort.signal,
        );
        if (!ok) this.tasksDisabled = true;
      });
    } catch {
      this.tasksDisabled = true;
      this.report(
        'invalid task snapshot (names, statuses, identities or 100-task limit)',
      );
    }
  }

  shutdown(outcome: RunOutcome, timeoutMs: number): Promise<void> {
    if (this.closing) return this.closing;
    this.stopped = true;
    this.closing = this.finish(outcome, Math.max(0, timeoutMs));
    return this.closing;
  }

  private async initialize(session: WizardSession): Promise<void> {
    const context = this.context;
    if (!context || context.mode === 'cloud') return;
    const projectName = basename(resolve(session.installDir))
      .trim()
      .slice(0, 255);
    if (!projectName) {
      this.tasksDisabled = true;
      this.report('unsupported program or workspace configuration');
      return;
    }
    const body = JSON.stringify({
      program_id: context.programId,
      environment: 'local',
      workspace: { type: 'local_folder', project_name: projectName },
      ...(validVersion(VERSION) ? { wizard_version: VERSION } : {}),
      idempotency_key: randomUUID(),
    });
    // POST retries remain disabled until deployed local idempotency is verified.
    const result = await this.request('POST', '', body, this.tasksAbort.signal);
    if (
      result &&
      typeof result === 'object' &&
      'id' in result &&
      typeof result.id === 'string' &&
      isUUID(result.id)
    ) {
      context.id = result.id;
    } else {
      this.tasksDisabled = true;
      this.report(
        'local creation failed or returned an invalid ID; creation was not retried',
      );
    }
  }

  private credentials(
    creds = this.options.getSession().credentials,
  ): Credentials | undefined {
    const context = this.context;
    if (!context) return;
    if (
      !creds ||
      creds.host.appHost.replace(/\/$/, '') !== context.apiHost ||
      creds.projectId !== context.projectId
    ) {
      this.report('execution credentials changed host or project');
      return;
    }
    if (
      creds.missingScopes?.includes('wizard_run:write') ||
      !creds.accessToken.startsWith('pha_')
    ) {
      this.authDisabled = true;
      this.report('wizard_run:write OAuth grant required; authorize again');
      return;
    }
    return creds;
  }

  private async request(
    method: 'POST' | 'PUT' | 'PATCH',
    suffix: string,
    body: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    const context = this.context;
    if (!context || this.authDisabled || signal.aborted) return;
    let refreshed = false;
    let rateLimited = false;
    const attempts = method === 'POST' ? 1 : 3;
    for (let attempt = 0; attempt < attempts && !signal.aborted; attempt++) {
      let retryMs = 500 * 2 ** attempt;
      try {
        const creds = this.credentials();
        if (!creds) return;
        const response = await this.bounded(
          async (requestSignal) => {
            // The run's OAuth session owns refresh, so the agent reads the same rotated token.
            const current = this.credentials(await currentCredentials(creds));
            if (!current) throw new Error('credentials unavailable');
            const res = await (this.options.fetchImpl ?? fetch)(
              `${context.apiHost}/api/projects/${context.projectId}/wizard/runs/${suffix}`,
              {
                method,
                body,
                signal: requestSignal,
                headers: {
                  Authorization: `Bearer ${current.accessToken}`,
                  'Content-Type': 'application/json',
                },
              },
            );
            const data: unknown =
              method === 'POST' && (res.status === 200 || res.status === 201)
                ? await res.json()
                : undefined;
            return { res, data, current };
          },
          signal,
          5000,
        );
        const { res, data, current } = response;
        if (
          (method === 'POST' && [200, 201].includes(res.status)) ||
          (method === 'PUT' && res.status === 204) ||
          (method === 'PATCH' && res.status === 200)
        )
          return data ?? true;
        if (
          res.status === 401 &&
          current.refreshToken &&
          !isGrantRevoked() &&
          !refreshed &&
          method !== 'POST'
        ) {
          refreshed = true;
          const rotated = await this.bounded(
            () => currentCredentials(current, true),
            signal,
            5000,
          );
          if (rotated.accessToken === current.accessToken) {
            this.authDisabled = true;
            this.report(
              'OAuth refresh could not recover the grant; authorize again',
            );
            return;
          }
          continue;
        }
        if (res.status === 401 || res.status === 403) this.authDisabled = true;
        if (res.status === 429 && !rateLimited) {
          rateLimited = true;
          retryMs = parseRetryAfter(res.headers.get('Retry-After'));
        } else if (res.status < 500 || res.status >= 600) {
          this.report(
            `${method} rejected (${res.status}); check assignment, grant and program configuration`,
          );
          return;
        }
      } catch {
        if (signal.aborted) return;
      }
      if (attempt + 1 < attempts) {
        try {
          await this.sleep(retryMs, signal);
        } catch {
          return;
        }
      }
    }
    this.report(`${method} delivery exhausted`);
  }

  private async finish(outcome: RunOutcome, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    try {
      await this.bounded(
        () => this.queue,
        new AbortController().signal,
        Math.floor(timeoutMs * 0.75),
      );
    } catch {
      this.report('task drain timed out');
    }
    this.tasksAbort.abort();
    if (this.context?.mode !== 'local' || !this.context.id || this.authDisabled)
      return;
    if (Date.now() >= deadline) {
      this.report('terminal update budget exhausted');
      return;
    }
    const finalAbort = new AbortController();
    const timer = setTimeout(
      () => finalAbort.abort(),
      Math.max(0, deadline - Date.now()),
    );
    try {
      await this.request(
        'PATCH',
        `${this.context.id}/`,
        JSON.stringify({ status: outcome }),
        finalAbort.signal,
      );
    } finally {
      clearTimeout(timer);
      finalAbort.abort();
    }
  }

  private async bounded<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    parent: AbortSignal,
    ms: number,
  ): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    parent.addEventListener('abort', abort, { once: true });
    if (parent.aborted) controller.abort();
    const timer = setTimeout(abort, ms);
    let onAbort: () => void = () => undefined;
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('request cancelled'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    });
    try {
      return await Promise.race([operation(controller.signal), cancelled]);
    } finally {
      clearTimeout(timer);
      parent.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', onAbort);
      controller.abort();
    }
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      signal.addEventListener('abort', finish, { once: true });
      if (signal.aborted) finish();
    });
  }

  private report(message: string): void {
    if (this.reported.has(message)) return;
    this.reported.add(message);
    (this.options.onError ?? ((m) => logToFile(`[wizard-run-sync] ${m}`)))(
      message,
    );
  }
}
