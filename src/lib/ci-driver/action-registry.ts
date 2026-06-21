/**
 * Screen → action registry for the CI driver.
 *
 * Maps every screen/overlay to the set of *commit* actions a user could
 * perform on it — and, for each, the single WizardStore setter/resolver that
 * commit goes through. This is the actuation half of the wizard-ci-tools
 * surface: instead of injecting keystrokes, a harness names an action and the
 * driver invokes the same store method the Ink screen's keyboard handler would.
 *
 * Discipline mirrors screen-registry.tsx: one entry per screen, kept exhaustive
 * by a test over the ScreenId/Overlay enums. No product knowledge leaks in —
 * actions speak only in store setters and generic params.
 */

import type { WizardStore } from '@ui/tui/store';
import { ScreenId, Overlay, type ScreenName } from '@ui/tui/router';
import { McpOutcome } from '@lib/wizard-session';
import type { AskAnswers } from '@lib/wizard-session';

/** One commit action legal on a given screen. */
export interface DriverAction {
  /** Stable action id named in perform_action. */
  id: string;
  /** One-line description of what committing this does. */
  description: string;
  /**
   * Parameter name → human/type hint. Absent = no params. The driver
   * validates presence of required params before applying.
   */
  params?: Record<string, string>;
  /** Apply the commit by calling exactly one store setter/resolver. */
  apply: (store: WizardStore, params: Record<string, unknown>) => void;
}

/** Thrown when perform_action references a missing required param. */
export class MissingParamError extends Error {
  constructor(action: string, param: string) {
    super(`Action "${action}" requires param "${param}".`);
    this.name = 'MissingParamError';
  }
}

function requireString(
  action: string,
  params: Record<string, unknown>,
  key: string,
): string {
  const v = params[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new MissingParamError(action, key);
  }
  return v;
}

/**
 * Screens with no committable user action (the runner or agent advances them):
 * auth (runner sets credentials), run (agent sets runPhase), ai-opt-in (gated on
 * org approval / ci auto-consent), exit, and the no-dismiss terminal overlays.
 * Listed explicitly so the exhaustiveness test can tell "intentionally empty"
 * from "forgotten".
 */
export const NO_ACTION_SCREENS: ReadonlySet<ScreenName> = new Set<ScreenName>([
  ScreenId.Auth,
  ScreenId.Run,
  ScreenId.AiOptIn,
  ScreenId.Exit,
  ScreenId.AuditRun,
  ScreenId.DoctorReport,
  ScreenId.SourceMapsOutro,
  ScreenId.AuditOutro,
  Overlay.ManagedSettings,
  Overlay.AuthError,
  Overlay.SessionTimeout,
]);

/**
 * Intro-style screens whose only action is "confirm and continue", committing
 * the same `setupConfirmed` flag the IntroScreen sets. Several programs reuse
 * this shape, so they share one action via this helper.
 */
const confirmSetupAction: DriverAction = {
  id: 'confirm_setup',
  description: 'Confirm the intro and continue (sets setupConfirmed).',
  apply: (store) => store.completeSetup(),
};

export const ACTION_REGISTRY: Partial<Record<ScreenName, DriverAction[]>> = {
  // ── Program intros — confirm & continue ───────────────────────────────
  [ScreenId.Intro]: [confirmSetupAction],
  [ScreenId.RevenueIntro]: [confirmSetupAction],
  [ScreenId.SourceMapsIntro]: [confirmSetupAction],
  [ScreenId.MigrationIntro]: [confirmSetupAction],
  [ScreenId.AgentSkillIntro]: [confirmSetupAction],
  [ScreenId.AuditIntro]: [confirmSetupAction],
  [ScreenId.DoctorIntro]: [confirmSetupAction],

  // ── Health check — dismiss a blocking outage ──────────────────────────
  [ScreenId.HealthCheck]: [
    {
      id: 'dismiss_outage',
      description: 'Dismiss the blocking outage screen and continue.',
      apply: (store) => store.dismissOutage(),
    },
  ],

  // ── Framework disambiguation ──────────────────────────────────────────
  [ScreenId.Setup]: [
    {
      id: 'choose',
      description:
        'Answer one setup question by committing a framework-context value. ' +
        'Read read_state.setupQuestions for the key and allowed values.',
      params: { key: 'setup question key', value: 'chosen option value' },
      apply: (store, params) => {
        const key = requireString('choose', params, 'key');
        const value = requireString('choose', params, 'value');
        store.setFrameworkContext(key, value);
      },
    },
  ],

  // ── Outro ─────────────────────────────────────────────────────────────
  [ScreenId.Outro]: [
    {
      id: 'dismiss_outro',
      description: 'Dismiss the outro and advance to the MCP step.',
      apply: (store) => store.setOutroDismissed(),
    },
  ],

  // ── MCP install ───────────────────────────────────────────────────────
  [ScreenId.Mcp]: [
    {
      id: 'set_mcp_outcome',
      description:
        'Complete the MCP step. outcome ∈ {installed, skipped}; clients optional.',
      params: {
        outcome: '"installed" | "skipped"',
        clients: 'string[] (optional)',
      },
      apply: (store, params) => {
        const raw = (params.outcome as string) ?? 'skipped';
        const outcome =
          raw === 'installed' ? McpOutcome.Installed : McpOutcome.Skipped;
        const clients = Array.isArray(params.clients)
          ? (params.clients as string[])
          : [];
        store.setMcpComplete(outcome, clients);
      },
    },
  ],
  [ScreenId.McpAdd]: [
    {
      id: 'set_mcp_outcome',
      description: 'Complete the standalone MCP-add flow.',
      params: { outcome: '"installed" | "skipped"' },
      apply: (store, params) => {
        const raw = (params.outcome as string) ?? 'skipped';
        store.setMcpComplete(
          raw === 'installed' ? McpOutcome.Installed : McpOutcome.Skipped,
        );
      },
    },
  ],
  [ScreenId.McpRemove]: [
    {
      id: 'set_mcp_outcome',
      description: 'Complete the standalone MCP-remove flow.',
      params: { outcome: '"installed" | "skipped"' },
      apply: (store, params) => {
        const raw = (params.outcome as string) ?? 'skipped';
        store.setMcpComplete(
          raw === 'installed' ? McpOutcome.Installed : McpOutcome.Skipped,
        );
      },
    },
  ],
  [ScreenId.McpSuggestedPrompts]: [
    {
      id: 'dismiss',
      description: 'Dismiss the suggested-prompts step.',
      apply: (store) => store.setMcpSuggestedPromptsDismissed(),
    },
  ],

  // ── Slack ─────────────────────────────────────────────────────────────
  [ScreenId.SlackConnect]: [
    {
      id: 'dismiss_slack',
      description: 'Skip or finish the Connect-Slack step.',
      apply: (store) => store.setSlackStepDismissed(),
    },
    {
      id: 'set_slack_connected',
      description: 'Mark Slack as connected (then dismiss to advance).',
      params: { connected: 'boolean' },
      apply: (store, params) =>
        store.setSlackConnected(params.connected !== false),
    },
  ],

  // ── Keep skills (terminal step of the integration flow) ───────────────
  [ScreenId.KeepSkills]: [
    {
      id: 'keep_skills',
      description:
        'Decide whether to keep installed skills; completes the run.',
      params: { kept: 'boolean (default true)' },
      apply: (store, params) => store.setSkillsComplete(params.kept !== false),
    },
  ],

  // ── Overlays ──────────────────────────────────────────────────────────
  [Overlay.WizardAsk]: [
    {
      id: 'answer_question',
      description:
        'Resolve the pending wizard_ask request. Supply a complete answers ' +
        'map: { [questionId]: string | string[] }. See read_state.pendingQuestion.',
      params: { answers: 'Record<questionId, string | string[]>' },
      apply: (store, params) => {
        const answers = (params.answers ?? {}) as AskAnswers;
        store.resolvePendingQuestion(answers);
      },
    },
    {
      id: 'cancel_question',
      description: 'Cancel the pending wizard_ask request (sentinel answers).',
      apply: (store) => store.cancelPendingQuestion(),
    },
  ],
  [Overlay.SettingsOverride]: [
    {
      id: 'backup_and_fix',
      description: 'Back up and fix conflicting .claude/settings.json.',
      apply: (store) => {
        store.backupAndFixSettingsOverride();
      },
    },
  ],
  [Overlay.PortConflict]: [
    {
      id: 'resolve_port_conflict',
      description:
        'Dismiss the port-conflict overlay and retry the OAuth port loop.',
      apply: (store) => store.resolvePortConflict(),
    },
  ],
  [Overlay.ManualAuthCode]: [
    {
      id: 'submit_auth_code',
      description: 'Submit a manually-entered OAuth authorization code.',
      params: { code: 'authorization code' },
      apply: (store, params) =>
        store.submitManualAuthCode(
          requireString('submit_auth_code', params, 'code'),
        ),
    },
    {
      id: 'dismiss_auth_code',
      description: 'Dismiss the manual auth-code overlay without submitting.',
      apply: (store) => store.dismissManualAuthCode(),
    },
  ],
};

/** Actions legal on the given screen — empty array if none. */
export function actionsForScreen(screen: ScreenName): DriverAction[] {
  return ACTION_REGISTRY[screen] ?? [];
}
