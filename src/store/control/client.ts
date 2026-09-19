import * as http from 'node:http';
import type {
  ControlState,
  DetectRequest,
  RunRecord,
  RunRequest,
} from './types.js';

export class ControlClientError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ControlClientError';
  }
}

interface HealthResponse {
  ok: true;
  version: string;
  surface: string;
  pid: number;
  program: string;
}

/** The parent's side of the control API: one unix socket, JSON in and out. */
export class ControlClient {
  constructor(private readonly socketPath: string) {}

  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/health');
  }

  async state(): Promise<ControlState> {
    return (await this.request<{ state: ControlState }>('GET', '/state')).state;
  }

  /** Long poll: the first commit with `version > since`, else after `waitMs`. */
  async waitForChange(since: number, waitMs: number): Promise<ControlState> {
    const path = `/state?wait=${waitMs}&since=${since}`;
    return (
      await this.request<{ state: ControlState }>(
        'GET',
        path,
        undefined,
        waitMs + 5000,
      )
    ).state;
  }

  async performAction(
    id: string,
    params: Record<string, unknown> = {},
  ): Promise<ControlState> {
    return (
      await this.request<{ state: ControlState }>(
        'POST',
        `/actions/${encodeURIComponent(id)}`,
        { params },
      )
    ).state;
  }

  async setCredentials(): Promise<ControlState> {
    return (
      await this.request<{ state: ControlState }>('POST', '/credentials', {})
    ).state;
  }

  /** TUI surface: release the runner's agent start. Idempotent. */
  async armRun(): Promise<ControlState> {
    return (await this.request<{ state: ControlState }>('POST', '/run', {}))
      .state;
  }

  async detect(req: DetectRequest = {}): Promise<ControlState> {
    return (await this.request<{ state: ControlState }>('POST', '/detect', req))
      .state;
  }

  async startRun(req: RunRequest): Promise<RunRecord> {
    return (await this.request<{ run: RunRecord }>('POST', '/runs', req)).run;
  }

  async runs(): Promise<RunRecord[]> {
    return (await this.request<{ runs: RunRecord[] }>('GET', '/runs')).runs;
  }

  async shutdown(): Promise<void> {
    await this.request<{ ok: true }>('POST', '/shutdown', {});
  }

  private request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    timeoutMs = 30_000,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          socketPath: this.socketPath,
          path,
          method,
          headers: payload
            ? {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload),
              }
            : {},
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let parsed: { ok?: boolean; error?: string } & Record<
              string,
              unknown
            >;
            try {
              parsed = JSON.parse(text) as typeof parsed;
            } catch {
              return reject(
                new ControlClientError(
                  res.statusCode ?? 0,
                  `bad response: ${text}`,
                ),
              );
            }
            const status = res.statusCode ?? 0;
            if (status >= 400 || parsed.ok === false) {
              return reject(
                new ControlClientError(
                  status,
                  parsed.error ?? `HTTP ${status}`,
                ),
              );
            }
            resolve(parsed as T);
          });
        },
      );
      req.on('timeout', () =>
        req.destroy(new Error('control request timed out')),
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }
}
