/**
 * The TUI's session: a program session plus the screen state the TUI adds.
 *
 * The store holds one; screens read it and change it through store setters,
 * and the router resolves the active screen from it.
 */

import { buildProgramSession } from '@programs';
import type { ProgramLaunchArgs, ProgramSession } from '@programs/types';
import type { WizardReadinessResult } from '@shared/health-checks/readiness';
import type { SettingsConflict } from '@shared/claude-settings';
import type { PendingQuestion, TaskNotice } from '@agent/types';
import { McpOutcome, RunPhase } from '@shared/run-state';

/** Screen state the TUI adds to a program session. */
export interface TuiSessionState {
  setupConfirmed: boolean;
  runPhase: RunPhase;
  loginUrl: string | null;
  // Direct PostHog authorize URL, shown in the manual-paste modal for
  // headless/remote shells (the localhost loginUrl is unreachable there).
  authorizeUrl: string | null;
  llmOptIn: boolean;
  mcpComplete: boolean;
  mcpOutcome: McpOutcome | null;
  mcpInstalledClients: string[];
  /** Editor-owned login commands still to run (e.g. `claude mcp login posthog`), echoed at exit. */
  mcpLoginCommands: string[];
  mcpSuggestedPromptsDismissed: boolean;
  /** True once the user has acted on (opened or skipped) the Connect-Slack step. */
  slackStepDismissed: boolean;
  /**
   * Whether the project already has a Slack integration connected.
   * `null` until detected. Prefetched by the tutorial screen as soon as
   * credentials exist so the Connect-Slack step renders the right
   * variant immediately instead of flashing the nudge first.
   */
  slackConnected: boolean | null;
  skillsComplete: boolean;
  outroDismissed: boolean;
  /**
   * Self-driving only: whether the user confirmed the handoff screen shown
   * after the integration run ("PostHog is installed — now set up Self-driving").
   * Gates the Self-driving run so it doesn't start until acknowledged. Only
   * reached in the integrate path; the already-has-PostHog path skips it.
   */
  selfDrivingHandoffConfirmed: boolean;
  /**
   * Self-driving only: whether the project has the PostHog GitHub App
   * connected. `null` until the GitHub gate's first check resolves. Self-driving
   * cannot research issues or open fixes without it, so the gate holds the run
   * until this is `true`.
   */
  githubConnected: boolean | null;
  /**
   * Self-driving only: the user answered "I can't connect right now" on the
   * GitHub gate. Completes the gate step and hides the run step, so the flow
   * lands on the outro without starting the agent.
   */
  githubDeclined: boolean;
  readinessResult: WizardReadinessResult | null;
  outageDismissed: boolean;
  settingsOverrideKeys: string[] | null;
  settingsConflicts: SettingsConflict[] | null;
  /** Mirrors `AuthErrorDetail` in `@ui/wizard-ui` — keep the two in step. */
  authErrorDetail: {
    hasSettingsConflict: boolean;
    conflicts?: SettingsConflict[];
    usingManagedLogin?: boolean;
    credentialPlaces?: string[];
    sessionExpired?: boolean;
    logFilePath: string;
  } | null;
  portConflictProcess: {
    command: string;
    pid: string;
    port: number;
    user: string;
  } | null;
  /** Copy for the task-notice modal, set while it is open. */
  taskNotice: TaskNotice | null;
  /** Skill saved for the user's own agent during the handoff. */
  spellbook: { path: string; skillsIncluded: boolean } | null;
  /**
   * How the user left the mint-failure screen: `continue` walks the
   * post-run steps (MCP, Slack, keep-skills), `exit` leaves. Null until then.
   */
  mintHandoff: 'continue' | 'exit' | null;
  programLabel: string | null;
  /** Active wizard_ask request, set by the bridge when the agent calls the tool. */
  pendingQuestion: PendingQuestion | null;
}

/** The TUI's session: the program session plus its own screen state. */
export type WizardSession = ProgramSession & TuiSessionState;

/**
 * Build a WizardSession from CLI args, pre-populating whatever is known.
 */
export function buildSession(args: ProgramLaunchArgs): WizardSession {
  return {
    ...buildProgramSession(args),
    setupConfirmed: false,
    runPhase: RunPhase.Idle,
    llmOptIn: false,
    mcpComplete: false,
    mcpOutcome: null,
    mcpInstalledClients: [],
    mcpLoginCommands: [],
    mcpSuggestedPromptsDismissed: false,
    slackStepDismissed: false,
    slackConnected: null,
    skillsComplete: false,
    outroDismissed: false,
    selfDrivingHandoffConfirmed: false,
    githubConnected: null,
    githubDeclined: false,
    loginUrl: null,
    authorizeUrl: null,
    readinessResult: null,
    outageDismissed: false,
    settingsOverrideKeys: null,
    settingsConflicts: null,
    authErrorDetail: null,
    portConflictProcess: null,
    taskNotice: null,
    spellbook: null,
    mintHandoff: null,
    programLabel: null,
    pendingQuestion: null,
  };
}
