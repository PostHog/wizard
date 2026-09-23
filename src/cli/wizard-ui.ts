/**
 * WizardUI — everything the CLI's runners ask of the current UI.
 *
 * CLI code calls `getUI()` instead of importing the store directly.
 * Implementations: InkUI (TUI), LoggingUI and HeadlessUI (headless); they
 * implement the progress and interaction halves from `@programs/types`.
 *
 * No prompt methods — the TUI screens own all user input.
 * Session-mutating methods trigger reactive screen resolution in the TUI.
 */

import type { SettingsConflict } from '@shared/claude-settings';
import type { WizardReadinessResult } from '@shared/health-checks/readiness';
import type { ApiUser, Credentials } from '@shared/api';
import type { OutroData } from '@shared/outro';
import type { InteractionUi, ProgressUi } from '@programs/types';

export interface WizardUI extends ProgressUi, InteractionUi {
  intro(message: string): void;
  /**
   * Error outro. Sets structured outroData and transitions run phase so
   * the router advances to the outro screen. Use for abort/failure paths
   * that need a custom error render — do NOT build the outroData by
   * mutating session directly (nanostore holds a shallow copy).
   */
  outroError(data: OutroData): void;
  /** Resolves when the user dismisses the outro screen (presses any key).
   *  Lets the abort path wait for the user to read the error before the
   *  process exits. Resolves immediately in non-TUI environments. */
  waitForOutroDismissed(): Promise<void>;
  cancel(message: string): void;
  note(message: string): void;
  /** Store OAuth/API credentials. Resolves past AuthScreen in TUI. */
  setCredentials(credentials: Credentials): void;
  /**
   * Replace the credentials after a token refresh. Same store write as
   * {@link setCredentials} without the `auth complete` capture — the user
   * authenticated once, and a refresh is not a second login.
   */
  setAccessToken(credentials: Credentials): void;
  /**
   * Persist the user's `role_at_organization` once it's been fetched from
   * `/api/users/@me/`. Drives role-tailored prompt suggestions on the
   * McpSuggestedPromptsScreen. Pass `null` to clear / when unknown.
   */
  setRoleAtOrganization(role: string | null): void;
  /**
   * Persist the full user payload from `/api/users/@me/` so downstream
   * screens can read account context (current org, team, plan, email,
   * preferences, etc.) without re-fetching. Pass `null` to clear or
   * when the request failed.
   */
  setApiUser(user: ApiUser | null): void;
  /**
   * Park until the org's AI opt-in gate clears
   * (`organization.is_ai_data_processing_approved === true`, or the
   * program never registered the gate — requiresAi: false / no auth
   * step / CI session). The agent runner awaits this after setApiUser
   * and BEFORE skill install or agent start: this is the enforcement
   * point that keeps source on the machine while the TUI shows
   * AiOptInRequiredScreen. Resolves immediately in non-TUI
   * environments (CI auto-consents to AI usage).
   */
  waitForAiOptIn(): Promise<void>;
  /** Show blocking service outage (pushes outage overlay in TUI). Blocks until dismissed. */
  showBlockingOutage(result: WizardReadinessResult): Promise<void>;
  /** Store non-blocking readiness warnings (shown as Health tab in RunScreen). */
  setReadinessWarnings(result: WizardReadinessResult): void;
  /** Warn that another process is blocking the OAuth port (pushes overlay in TUI). */
  showPortConflict(processInfo: {
    command: string;
    pid: string;
    port: number;
    user: string;
  }): Promise<void>;
  /**
   * Resolve with an OAuth authorization code the user enters by hand — the
   * fallback for headless/remote shells where the browser can't reach the
   * local callback server. The OAuth flow races this against the callback
   * server. Implementations that can't prompt (CI/logging) never resolve.
   */
  waitForManualAuthCode(): Promise<string>;
  showSettingsOverride(
    conflicts: SettingsConflict[],
    backupAndFix: () => boolean,
  ): Promise<void>;
  /** Show the session-timeout overlay when the OAuth login window expires. */
  showSessionTimeout(): void;
  /** Set the detected framework label (e.g., "Django with Wagtail CMS") */
  setDetectedFramework(label: string): void;
  /** Register a callback to run when the TUI transitions onto the given screen. */
  onEnterScreen(screen: string, fn: () => void): void;
  setLoginUrl(url: string | null): void;
  /** Direct PostHog authorize URL, shown in the manual-paste modal. */
  setAuthorizeUrl(url: string | null): void;
  setEventPlan(events: Array<{ name: string; description: string }>): void;
  setFrameworkContext(key: string, value: unknown): void;
  /** Read a frameworkContext value from the LIVE session (store may have
   * forked the reference the runner holds). Used by run configs to read
   * values written by post-auth screens (e.g. the source-maps picker). */
  getFrameworkContext(key: string): unknown;
  /** Park until the named program step's gate predicate flips true. Resolves
   * immediately if the step has no gate. Mirrors waitForAiOptIn for any
   * post-auth interactive step the agent run must wait on. */
  waitForGate(stepId: string): Promise<void>;
}
