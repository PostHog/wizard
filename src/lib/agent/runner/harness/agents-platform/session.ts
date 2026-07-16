/**
 * Minimal driver for a hosted agent-platform session.
 *
 * Two calls: `POST /agents/<slug>/run` opens a session and starts a turn, then
 * `GET /agents/<slug>/listen` streams it as SSE. Client tool calls arrive on the
 * stream and are fulfilled inline — the remote runner blocks its tool `execute()`
 * on a matching `client_tool_result`, so a call we never answer hangs the turn.
 *
 * Transport only. Nothing audit-specific lives here; the caller interprets
 * events via `onEvent`.
 */
import { logToFile } from '@utils/debug';

/**
 * The subset of `SessionEventKind` this client acts on. The platform emits
 * more (thinking deltas, tool_call_start, args deltas); we ignore what we
 * don't use rather than enumerate it.
 */
export type SessionEvent =
  | { kind: 'assistant_text_delta'; data: { text?: string } }
  | { kind: 'tool_call'; data: { name?: string; args?: unknown } }
  | {
      kind: 'tool_result';
      data: { name?: string; ok?: boolean; error?: string; output?: unknown };
    }
  | {
      kind: 'client_tool_call';
      data: {
        call_id: string;
        tool_id: string;
        args?: Record<string, unknown>;
      };
    }
  | { kind: 'failed'; data: Record<string, unknown> }
  | { kind: string; data: Record<string, unknown> };

/** Events that end the turn and close the stream. */
const TERMINAL_KINDS = new Set([
  'completed',
  'closed',
  'interrupted',
  'failed',
]);

export type TurnOutcome =
  | 'completed'
  | 'closed'
  | 'interrupted'
  | 'failed'
  | 'no_terminal_event';

export interface CloudSessionOptions {
  /**
   * Fully-resolved base URL for the agent, with no trailing slash — the
   * endpoints below hang directly off it. This is a base rather than an
   * origin + slug because the ingress has two routing modes: `domain` puts
   * the slug in the host and routes at root, `path` puts it in the path.
   * See resolveAgentBaseUrl.
   */
  baseUrl: string;
  /**
   * PostHog access token. The agent's chat trigger declares `posthog` auth, so
   * the ingress introspects this against /api/users/@me/ and checks org
   * entitlement. A PAT or an OAuth access token both work.
   */
  bearer: string;
  /** Opening user message for the turn. */
  task: string;
  /** Client tool ids this driver can fulfil. */
  supportedClientTools: readonly string[];
  /** Fulfils one client tool call. Throwing reports an error to the agent. */
  onClientTool: (
    toolId: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  /** Observes every parsed event. Must not throw. */
  onEvent?: (event: SessionEvent) => void;
  signal?: AbortSignal;
}

export class CloudSessionError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'CloudSessionError';
  }
}

function authHeaders(bearer: string): Record<string, string> {
  return { authorization: `Bearer ${bearer}` };
}

/**
 * Turn an ingress failure into something a human can act on. 401/403 are the
 * predictable ones: the platform is internal-only and its `posthog` auth mode
 * requires the caller to be in the agent's own organization.
 */
function describeHttpFailure(status: number, body: string): string {
  if (status === 401) {
    return 'The PostHog agent platform rejected your credentials (401). Try re-authenticating the wizard.';
  }
  if (status === 403) {
    return `The PostHog agent platform denied access (403). The hosted audit agent is currently limited to PostHog staff.\n${body}`;
  }
  if (status === 404) {
    return `The hosted audit agent was not found (404). It may not be deployed in this region.\n${body}`;
  }
  return `Agent platform request failed (${status}): ${body}`;
}

export class CloudAuditSession {
  private readonly base: string;

  constructor(private readonly opts: CloudSessionOptions) {
    this.base = opts.baseUrl.replace(/\/$/, '');
  }

  /** Open a session, start the turn, and stream it to completion. */
  async run(): Promise<{ sessionId: string; outcome: TurnOutcome }> {
    const sessionId = await this.startTurn();
    logToFile(`[cloud-audit] session ${sessionId} started`);
    const outcome = await this.streamTurn(sessionId);
    logToFile(`[cloud-audit] session ${sessionId} ended: ${outcome}`);
    return { sessionId, outcome };
  }

  private async startTurn(): Promise<string> {
    const res = await fetch(`${this.base}/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(this.opts.bearer),
      },
      body: JSON.stringify({
        message: this.opts.task,
        supported_client_tools: this.opts.supportedClientTools,
      }),
      signal: this.opts.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new CloudSessionError(
        describeHttpFailure(res.status, text),
        res.status,
      );
    }
    const body = JSON.parse(text) as { session_id?: string };
    if (!body.session_id) {
      throw new CloudSessionError(
        'Agent platform did not return a session id.',
      );
    }
    return body.session_id;
  }

  private async postClientToolResult(
    sessionId: string,
    callId: string,
    result: unknown,
    error?: string,
  ): Promise<void> {
    const body =
      error !== undefined
        ? { session_id: sessionId, call_id: callId, error }
        : { session_id: sessionId, call_id: callId, result };
    const res = await fetch(`${this.base}/client_tool_result`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(this.opts.bearer),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Don't throw: the turn is still live and the agent may recover. Losing
      // one result stalls that tool call, not the whole run.
      logToFile(
        `[cloud-audit] client_tool_result ${res.status}: ${await res.text()}`,
      );
    }
  }

  private async handleClientToolCall(
    sessionId: string,
    data: { call_id: string; tool_id: string; args?: Record<string, unknown> },
  ): Promise<void> {
    try {
      const result = await this.opts.onClientTool(
        data.tool_id,
        data.args ?? {},
      );
      await this.postClientToolResult(sessionId, data.call_id, result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logToFile(`[cloud-audit] client tool ${data.tool_id} failed: ${message}`);
      await this.postClientToolResult(
        sessionId,
        data.call_id,
        undefined,
        message,
      );
    }
  }

  /** Stream one turn, fulfilling client tool calls as they arrive. */
  private async streamTurn(sessionId: string): Promise<TurnOutcome> {
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    this.opts.signal?.addEventListener('abort', onAbort);

    const res = await fetch(
      `${this.base}/listen?session_id=${encodeURIComponent(sessionId)}`,
      { headers: authHeaders(this.opts.bearer), signal: controller.signal },
    );
    if (!res.ok || !res.body) {
      this.opts.signal?.removeEventListener('abort', onAbort);
      throw new CloudSessionError(
        describeHttpFailure(res.status, await res.text()),
        res.status,
      );
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let outcome: TurnOutcome = 'no_terminal_event';

    try {
      stream: for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line; we only read `data:`.
        let split: number;
        while ((split = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);

          const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;

          let event: SessionEvent;
          try {
            event = JSON.parse(dataLine.slice(5).trim()) as SessionEvent;
          } catch {
            continue;
          }

          this.opts.onEvent?.(event);

          if (event.kind === 'client_tool_call') {
            await this.handleClientToolCall(
              sessionId,
              event.data as {
                call_id: string;
                tool_id: string;
                args?: Record<string, unknown>;
              },
            );
            continue;
          }

          if (TERMINAL_KINDS.has(event.kind)) {
            outcome = event.kind as TurnOutcome;
            break stream;
          }
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* stream already torn down */
      }
      controller.abort();
      this.opts.signal?.removeEventListener('abort', onAbort);
    }

    return outcome;
  }
}
