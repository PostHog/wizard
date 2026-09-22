/**
 * The agent's public progress and interaction contracts.
 *
 * `runAgent` reports through one optional callback and asks through one
 * optional set of capabilities. Neither reaches into a UI singleton, a store,
 * or a session: every payload is copied data, every question is awaited on an
 * injected answerer. The legacy adapter in `src/lib/programs/run-agent-legacy.ts`
 * maps these back onto `WizardUI` one call per event, so the terminal output of
 * every existing runner is unchanged.
 */

import type {
  AskAnswers,
  OutroData,
  PendingQuestion,
  TaskNotice,
} from '@lib/wizard-session';
import type { SettingsConflict } from './claude-settings';

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
 * Context the agent attaches to a 401 so the host can pick the right copy.
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

/** One task as the host renders it. The same shape `WizardUI.syncTodos` takes. */
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
  /** The run finished and the host may show its outro (`WizardUI.outro`). */
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
  /** The run's final outro payload (`WizardUI.setOutroData`). */
  | { kind: 'completion'; outro: OutroData };

export type ProgressEmitter = (event: AgentProgress) => void;

/**
 * The questions the agent may need a person (or a script) to answer. Every
 * capability is optional. With none supplied the agent installs no ask bridge,
 * so `wizard_ask` returns its existing "not available" error, and an optional
 * task notice is declined — the same path a `--ci` run takes today.
 */
export interface AgentInteraction {
  /**
   * Open a question and resolve with the answers. The bridge that calls this
   * owns the timeout, the `__cancelled__` sentinel and the analytics.
   */
  ask?: (question: PendingQuestion) => Promise<AskAnswers>;
  /** Dismiss the in-flight question as cancelled (timeouts call this). */
  cancelAsk?: () => void;
  /** Offer an optional step and resolve with whether to keep it. */
  taskNotice?: (notice: TaskNotice) => Promise<boolean>;
  /** Dismiss an in-flight task notice as declined (timeouts call this). */
  cancelTaskNotice?: () => void;
}
