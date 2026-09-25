/**
 * The agent's public progress and interaction contracts.
 *
 * `runAgent` reports through one optional callback and asks through one
 * optional set of capabilities. Neither reaches into a UI singleton, a store,
 * or a session: every payload is copied data, every question is awaited on an
 * injected answerer. The legacy adapter in `src/programs/run-agent-legacy.ts`
 * maps these back onto `WizardUI` one call per event, so the terminal output of
 * every existing runner is unchanged.
 */

import type { SettingsConflict } from '@shared/claude-settings';

// ── What the agent hands back and asks with ─────────────────────────

/** Outcome kind for the outro screen */
export enum OutroKind {
  Success = 'success',
  Error = 'error',
  Cancel = 'cancel',
}

export interface OutroData {
  kind: OutroKind;
  /** Main headline (green check for Success, red X for Error, etc.) */
  message?: string;
  /** Free-form body text shown under the headline. Use \n for paragraph breaks. */
  body?: string;
  /** Success-only: bulleted list of "what the agent did" */
  changes?: string[];
  /**
   * Success-only: a prominent, labeled link to where the user should go
   * next (e.g. an inbox the program just configured). Rendered right under
   * the headline and shown verbatim — no UTM tagging — so the URL stays
   * clean and copy-pasteable. Set per-program in buildOutroData.
   */
  primaryLink?: { label: string; url: string };
  /**
   * Success-only: a short "what to do next" checklist with its own heading,
   * rendered as a bulleted list. Distinct from `changes`, which recaps what
   * the agent already did.
   */
  nextSteps?: { heading: string; items: string[] };
  docsUrl?: string;
  continueUrl?: string;
  /** Report file the agent wrote (e.g. "posthog-setup-report.md") */
  reportFile?: string;
  /** Stable machine-readable error code from the error catalog (@lib/errors). */
  errorCode?: import('@shared/errors').ErrorCode;
  /** Structured context for the error code; safe for telemetry payloads. */
  errorDetail?: Record<string, unknown>;
  /** PostHog dashboard URL the program created on the user's behalf. */
  dashboardUrl?: string;
  /** PostHog notebook URL the program uploaded the report to. */
  notebookUrl?: string;
  /**
   * Copy-paste prompt the operator hands to their coding agent to finish the
   * job (work the report's checklist). Printed to the terminal's main buffer on
   * exit (see getExitLine in start-tui.ts) — the TUI's alternate screen is wiped
   * on exit, so the scrollback line is where it survives and can be
   * triple-click-selected. Set per-program in buildOutroData.
   */
  handoffPrompt?: string;
}

/** A single question rendered by the WizardAsk overlay. */
export interface AskQuestion {
  /** Key for the response map */
  id: string;
  prompt: string;
  /** text = single-line free input; single/multi = picker */
  kind: 'single' | 'multi' | 'text';
  /** Required for `single` and `multi`. Ignored for `text`. */
  options?: { label: string; value: string; description?: string }[];
  /** Defaults to true */
  required?: boolean;
  /**
   * Only meaningful for kind='text'. When true, the wizard-tools `wizard_ask`
   * tool stores the user's answer in the session secret vault and returns
   * `{ secretRef }` to the agent instead of the plain string — so the value
   * never enters the LLM conversation. The TUI masks the input as it is typed
   * (see `shouldMaskAnswer`). See `secret-vault.ts`.
   */
  sensitive?: boolean;
}

/**
 * Copy for a modal shown before an optional step runs, so the user can decline
 * it. The program that owns the step supplies the words; the runner and the
 * screen only carry them.
 */
export interface TaskNotice {
  title: string;
  /** Paragraphs, in order. */
  body: string[];
  /** Optional highlighted list, e.g. what was detected. */
  items?: string[];
  docsLabel?: string;
  docsUrl?: string;
  confirmLabel: string;
  cancelLabel: string;
  prompt: string;
}

/** Map of question id → answer (string for single/text, string[] for multi). */
export type AskAnswers = Record<string, string | string[]>;

/** A pending wizard_ask request held by the store. */
export interface PendingQuestion {
  id: string;
  questions: AskQuestion[];
  /**
   * UTC ISO 8601 timestamp of when the ask was created. Published on the
   * task stream as `pending_input.asked_at` so the web app can age the
   * prompt; stable across pushes for the lifetime of one ask.
   */
  askedAt?: string;
  /** Skill id of the caller. Set by the wizard from session.skillId. */
  source: string;
  /**
   * When true, the ask overlay renders standalone URLs in prompt text as
   * OSC 8 hyperlinks and copies a lone URL to the clipboard. Opt-in per
   * program (set from `AgentRunDefinition.richLinks` via the ask bridge); defaults
   * to false so existing flows render prompts exactly as before. See
   * `LinkText` / `link-helpers`.
   */
  richLinks?: boolean;
}

// ── What the agent reports ──────────────────────────────────────────

/**
 * One assistant turn's token usage, for the hidden Ctrl+T token/cost HUD.
 * `model` is the model that produced *this* turn (e.g. the SDK's
 * `message.message.model`) — a subagent can run on a different model than
 * the main session, and some programs override to Haiku, so pricing must key
 * off the per-turn model rather than a single run-wide assumption. Omit only
 * when the caller genuinely has no model context (falls back to Sonnet
 * pricing — see `pricePerMtokForModel` in `@lib/agent/token-pricing`).
 */
export interface TokenUsageDelta {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheCreation5m: number;
  cacheCreation1h: number;
  model?: string;
}

/** The run spinner as the agent drives it: `WizardUI.spinner()` returns one. */
export interface SpinnerHandle {
  start(message?: string): void;
  stop(message?: string): void;
  message(msg?: string): void;
}

/**
 * Context the agent attaches to a 401 so the caller can pick the right copy.
 *
 * `hasSettingsConflict` is true when a Claude Code settings file (project,
 * project-local, the user's global config, or managed) actually overrides the
 * LLM Gateway auth. `conflicts` carries the exact files and keys so the screen
 * can name them. When there is no conflict, the 401 has a different cause (bad
 * PAT prefix, missing scope, expired key, region mismatch) and we should not
 * advise the user to log out of Claude Code.
 */
export interface AuthErrorDetail {
  hasSettingsConflict: boolean;
  conflicts?: SettingsConflict[];
  /**
   * True when the agent SDK authenticated from a stored Claude login
   * (`apiKeySource: "/login managed key"`) instead of the wizard's gateway
   * token — conflicting Anthropic credentials. Takes priority in the screen.
   */
  usingManagedLogin?: boolean;
  /** Human-readable places a conflicting Anthropic credential may live. */
  credentialPlaces?: string[];
  /**
   * True when a pre-run refresh already failed on a dead grant. The login is
   * gone and re-running is the only fix, so this outranks every other branch —
   * none of the usual advice (key type, scopes, region) applies.
   */
  sessionExpired?: boolean;
  logFilePath: string;
}

/** One task as the caller renders it. The same shape `WizardUI.syncTodos` takes. */
export interface TaskSnapshot {
  content: string;
  status: string;
  activeForm?: string;
}

export type ProgressLogLevel = 'info' | 'warn' | 'error' | 'success' | 'step';

/**
 * Everything the agent reports while it runs. One event per former
 * `getUI()` call, in the same order, with the same payload, so a reducer that
 * maps each case back onto `WizardUI` reproduces today's output exactly.
 *
 * Payloads are copies. Never a store, a setter, a function or a live
 * collection. The callback returns nothing and the agent never branches on it.
 */
export type AgentProgress =
  /** The run's main work has started (`WizardUI.startRun`). */
  | { kind: 'lifecycle'; phase: 'started' }
  /** The run finished and the caller may show its outro (`WizardUI.outro`). */
  | { kind: 'lifecycle'; phase: 'completed'; message: string }
  /** The run spinner (`WizardUI.spinner()`), one handle per run. */
  | {
      kind: 'spinner';
      action: 'start' | 'stop' | 'message';
      message?: string;
    }
  /** A log line (`WizardUI.log[level]`). */
  | { kind: 'log'; level: ProgressLogLevel; message: string }
  /** A `[STATUS]` line the agent printed (`WizardUI.pushStatus`). */
  | { kind: 'status'; message: string }
  /** The full task list, already sorted for display (`WizardUI.syncTodos`). */
  | { kind: 'tasks'; tasks: TaskSnapshot[] }
  /** The stage of work derived from the active tool (`WizardUI.setStage`). */
  | { kind: 'stage'; stage: string }
  /** A PostHog URL the agent created (`setDashboardUrl` / `setNotebookUrl`). */
  | { kind: 'url'; which: 'dashboard' | 'notebook'; url: string }
  /** One assistant turn's token usage (`WizardUI.addTokenUsage`). */
  | { kind: 'usage'; delta: TokenUsageDelta }
  /** The SDK's authoritative run cost (`WizardUI.setFinalTokenCostUsd`). */
  | { kind: 'finalCost'; usd: number }
  /** The gateway returned 401; a failure follows (`WizardUI.showAuthError`). */
  | { kind: 'authError'; detail: AuthErrorDetail }
  /** The handoff document the agent published (`WizardUI.setHandoffText`). */
  | { kind: 'handoff'; text: string }
  /** The run's final outro payload (`WizardUI.setOutroData`). */
  | { kind: 'completion'; outro: OutroData }
  /** One short line per agent step, only from a run that collects its transcript. */
  | { kind: 'activity'; line: string };

export type ProgressEmitter = (event: AgentProgress) => void;

/**
 * The questions the agent may need a person (or a script) to answer. Every
 * capability is optional. With none supplied the agent installs no ask bridge,
 * so `wizard_ask` returns its existing "not available" error, and an optional
 * task notice is declined — the same path a `--ci` run takes today.
 * Each request's `signal` aborts when that request times out, the run's
 * signal aborts, or another task fails the run. On that abort the caller
 * dismisses that request alone, and that dismissal must not throw: abort
 * listeners run where the agent cannot catch them, so Node would rethrow the
 * error as an uncaught exception.
 */
export interface AgentInteraction {
  /**
   * Open a question and resolve with the answers. The bridge that calls this
   * owns the timeout, the `__cancelled__` sentinel and the analytics.
   */
  ask?: (
    question: PendingQuestion,
    context: { signal: AbortSignal },
  ) => Promise<AskAnswers>;
  /** Offer an optional step and resolve with whether to keep it. */
  taskNotice?: (
    notice: TaskNotice,
    context: { signal: AbortSignal },
  ) => Promise<boolean>;
}
