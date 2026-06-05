import { AgentSignals, AgentErrorType } from '../../signals';
import { AgentOutputSignals } from '../../output-signals';
import { findAbortReason } from './errors';
import type { TaskEntry } from './tools/types';

/**
 * Stream → TUI bridge shared by the model-agnostic runners.
 *
 * The Anthropic path's `handleSDKMessage` does double duty: it drives the TUI
 * (status line, dashboard/notebook URLs, todo list) and accumulates the signal
 * markers `runAgent` inspects after the loop. The `pi`/`vercel` runners own
 * their own loops over different SDK event shapes, but the *content* they carry
 * — assistant text and task mutations — is identical, so the reaction to it
 * lives here once.
 *
 * A runner feeds assistant text in via {@link handleAssistantText} and task
 * store changes via {@link syncTasks}, then calls {@link finalize} to turn the
 * accumulated signals into the same `{ error?, message? }` result the SDK path
 * returns. Transport/loop exceptions are mapped by `mapRunnerError` in the
 * runner's catch; this bridge handles only the in-band signal surface.
 */

/** The subset of the wizard UI the bridge drives. */
export interface BridgeUI {
  pushStatus(message: string): void;
  setDashboardUrl(url: string): void;
  setNotebookUrl(url: string): void;
  syncTodos(
    todos: Array<{ content: string; status: string; activeForm?: string }>,
  ): void;
}

/** Spinner surface the bridge updates as `[STATUS]` markers arrive. */
export interface BridgeSpinner {
  message(msg?: string): void;
}

/** The result shape every runner resolves to — mirrors `runAgent`. */
export interface BridgeResult {
  error?: AgentErrorType;
  message?: string;
}

// Status markers can appear mid-line; dashboard/notebook URLs are whitespace-
// delimited tokens. These mirror the regexes in agent-interface's
// handleSDKMessage so marker handling doesn't drift across runners.
function escape(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const STATUS_RE = new RegExp(
  `^.*${escape(AgentSignals.STATUS)}\\s*(.+?)$`,
  'm',
);
const DASHBOARD_RE = new RegExp(
  `${escape(AgentSignals.DASHBOARD_URL)}\\s*(\\S+)`,
  'm',
);
const NOTEBOOK_RE = new RegExp(
  `${escape(AgentSignals.NOTEBOOK_URL)}\\s*(\\S+)`,
  'm',
);

// Todo ordering matches the SDK path: completed first, then in_progress, then
// pending. Array.prototype.sort is stable, so creation order holds within a
// group.
const STATUS_RANK: Record<string, number> = { completed: 0, in_progress: 1 };
const rankOf = (status: string): number => STATUS_RANK[status] ?? 2;

export class RunBridge {
  readonly signals = new AgentOutputSignals();
  private abortReason: string | null = null;

  constructor(
    private readonly ui: BridgeUI,
    private readonly spinner: BridgeSpinner,
  ) {}

  /**
   * Process a block of assistant text: retain its signal markers, surface
   * `[STATUS]`/`[DASHBOARD_URL]`/`[NOTEBOOK_URL]` to the TUI, and capture the
   * first `[ABORT]` reason. Returns the abort reason the moment one is seen so
   * the runner can tear down its loop.
   */
  handleAssistantText(text: string): { abort?: string } {
    this.signals.push(text);

    const status = text.match(STATUS_RE);
    if (status) {
      const statusText = status[1].trim();
      this.ui.pushStatus(statusText);
      this.spinner.message(statusText);
    }

    const dashboard = text.match(DASHBOARD_RE);
    if (dashboard) this.ui.setDashboardUrl(dashboard[1].trim());

    const notebook = text.match(NOTEBOOK_RE);
    if (notebook) this.ui.setNotebookUrl(notebook[1].trim());

    if (!this.abortReason) {
      const reason = findAbortReason(text);
      if (reason) this.abortReason = reason;
    }
    return this.abortReason ? { abort: this.abortReason } : {};
  }

  /** The captured `[ABORT]` reason, if the agent asked to abort. */
  get abort(): string | null {
    return this.abortReason;
  }

  /** Re-render the todo list from the shared task store, in display order. */
  syncTasks(tasks: Map<string, TaskEntry>): void {
    const sorted = Array.from(tasks.values()).sort(
      (a, b) => rankOf(a.status) - rankOf(b.status),
    );
    this.ui.syncTodos(sorted);
  }

  /**
   * Collapse the accumulated signals into a runner result, mirroring the
   * post-loop checks in `runAgent`: abort first, then YARA, then missing
   * MCP/resource, then rate-limit/API errors, else success (`{}`). The
   * end-of-run remark is returned for the caller to capture via analytics.
   */
  finalize(): BridgeResult {
    if (this.abortReason) {
      return { error: AgentErrorType.ABORT, message: this.abortReason };
    }
    if (this.signals.hasYaraViolation()) {
      return { error: AgentErrorType.YARA_VIOLATION };
    }
    if (this.signals.has('MCP_MISSING')) {
      return { error: AgentErrorType.MCP_MISSING };
    }
    if (this.signals.has('RESOURCE_MISSING')) {
      return { error: AgentErrorType.RESOURCE_MISSING };
    }
    const apiErrorMessage =
      this.signals.apiErrorMessage() ?? 'Unknown API error';
    if (this.signals.hasApiErrorStatus(429)) {
      return { error: AgentErrorType.RATE_LIMIT, message: apiErrorMessage };
    }
    if (this.signals.hasApiError()) {
      return { error: AgentErrorType.API_ERROR, message: apiErrorMessage };
    }
    return {};
  }

  /** The agent's end-of-run remark, if it emitted one. */
  remark(): string | undefined {
    return this.signals.remark();
  }
}
