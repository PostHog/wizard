/** TuiState: what only the TUI's screens read and write, kept in its store beside the shared session. */

import type { AuthErrorDetail } from '@agent/types';
import type { SettingsConflict } from '@shared/claude-settings';
import type { McpOutcome } from '@shared/run-state';
import type { WizardSession } from '@programs/types';

/** The launch choices only the TUI takes. */
export type TuiLaunchChoices = {
  /** `mcp add --features`: the features to preselect. */
  mcpFeatures?: string[];
  /** `--integrate`: integrate PostHog without asking. */
  integrate?: boolean;
};

export type TuiState = {
  /** `mcp add --features`: the features to preselect. */
  mcpFeatures: string[] | undefined;

  /** The program this invocation runs; null until a host launches the store with one. */
  programLabel: string | null;

  // From detection + screens
  setupConfirmed: boolean;

  // Login overlays
  /** The localhost login URL the auth screen shows while the OAuth flow waits. */
  loginUrl: string | null;
  /** Direct PostHog authorize URL, shown in the manual-paste modal for remote shells. */
  authorizeUrl: string | null;

  // Screen completion
  mcpComplete: boolean;
  mcpOutcome: McpOutcome | null;
  /** Editor-owned login commands still to run (e.g. `claude mcp login posthog`), echoed at exit. */
  mcpLoginCommands: string[];
  /** The editors the MCP step installed into, for the suggested-prompts screen. */
  mcpInstalledClients: string[];
  mcpSuggestedPromptsDismissed: boolean;
  /** True once the user has acted on (opened or skipped) the Connect-Slack step. */
  slackStepDismissed: boolean;
  /** Whether the project already has a Slack integration; `null` until detected. */
  slackConnected: boolean | null;
  skillsComplete: boolean;
  outroDismissed: boolean;

  /**
   * Self-driving only: whether to integrate PostHog as part of this run.
   * `null` until decided; `--integrate` pre-sets it to `true`.
   */
  integrate: boolean | null;
  /** Ids of composed run steps that have completed, e.g. self-driving's `integrate-run`. */
  completedRuns: string[];
  /** Self-driving only: the user confirmed the handoff after the integration run. */
  selfDrivingHandoffConfirmed: boolean;
  /** Self-driving only: whether the PostHog GitHub App is connected; `null` until checked. */
  githubConnected: boolean | null;
  /** Self-driving only: the user can't connect GitHub now, so the run is skipped. */
  githubDeclined: boolean;

  // Overlays
  outageDismissed: boolean;
  settingsOverrideKeys: string[] | null;
  settingsConflicts: SettingsConflict[] | null;
  authErrorDetail: AuthErrorDetail | null;
  portConflictProcess: {
    command: string;
    pid: string;
    port: number;
    user: string;
  } | null;
  /** Skill saved for the user's own agent during the handoff. */
  spellbook: { path: string; skillsIncluded: boolean } | null;
  /** How the user left the mint-failure screen; null until then. */
  mintHandoff: 'continue' | 'exit' | null;
};

/** What a step predicate reads: the shared session and the TUI's own state. A `WizardStore` is one. */
export type TuiView = Readonly<TuiState> & { readonly session: WizardSession };

/** The TUI state a run starts with: the screens' defaults, the launch choices and the program it runs. */
export function initialTuiState(
  choices: TuiLaunchChoices = {},
  programLabel: string | null = null,
): TuiState {
  return {
    mcpFeatures: choices.mcpFeatures,
    programLabel,
    setupConfirmed: false,
    loginUrl: null,
    authorizeUrl: null,
    mcpComplete: false,
    mcpOutcome: null,
    mcpLoginCommands: [],
    mcpInstalledClients: [],
    mcpSuggestedPromptsDismissed: false,
    slackStepDismissed: false,
    slackConnected: null,
    skillsComplete: false,
    outroDismissed: false,
    // `--integrate` forces integration (skip the question); otherwise the
    // integration-check screen resolves it from null.
    integrate: choices.integrate === true ? true : null,
    completedRuns: [],
    selfDrivingHandoffConfirmed: false,
    githubConnected: null,
    githubDeclined: false,
    outageDismissed: false,
    settingsOverrideKeys: null,
    settingsConflicts: null,
    authErrorDetail: null,
    portConflictProcess: null,
    spellbook: null,
    mintHandoff: null,
  };
}
