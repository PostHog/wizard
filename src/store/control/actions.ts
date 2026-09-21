/** The commits a parent may make, keyed by flow key or interrupt; a program adds its own through `FlowStep.controlActions`. */
import {
  McpOutcome,
  ScanConsent,
  type AskAnswers,
} from '../session/wizard-session.js';
import type { Flow } from '../state/flow.js';
import { FLOW_KEY } from '../state/flow-resolution.js';
import { Interrupt } from '../state/interrupts.js';
import {
  optionalBoolean,
  optionalOneOf,
  optionalStringArray,
  requireRecord,
  requireString,
} from './params.js';
import type { ActionView, DriverAction } from './types.js';

/** Thrown when an action is not legal on the current screen. Maps to 400. */
export class UnknownActionError extends Error {
  constructor(action: string, screen: string) {
    super(
      `No action "${action}" on screen "${screen}". ` +
        'Read state.actions first.',
    );
    this.name = 'UnknownActionError';
  }
}

/** Screens with no commit: the runner or the agent advances them, or they are terminal. */
export const NO_ACTION_SCREENS: ReadonlySet<string> = new Set<string>([
  FLOW_KEY.Auth,
  FLOW_KEY.Run,
  'ai-opt-in',
  FLOW_KEY.Exit,
  'audit-run',
  'doctor-report',
  Interrupt.ManagedSettings,
  Interrupt.AuthError,
  Interrupt.SessionTimeout,
]);

const confirmSetup: DriverAction = {
  id: 'confirm_setup',
  description: 'Confirm the intro and continue (sets setupConfirmed).',
  apply: (store) => store.completeSetup(),
};

/** The default intro also decides scan sharing; Enter grants when undecided, as its key handler does. */
const confirmSetupWithSharing: DriverAction = {
  id: 'confirm_setup',
  description:
    'Confirm the intro and continue. share: true grants and false declines ' +
    'sharing scan results; absent keeps the toggle (granted when undecided).',
  params: { share: 'boolean (optional)' },
  apply: (store, params) => {
    const share =
      params.share === undefined
        ? undefined
        : optionalBoolean('confirm_setup', params, 'share', true);
    if (share === false) {
      store.declineSharing();
    } else if (
      share === true ||
      store.session.scanConsent === ScanConsent.Undecided
    ) {
      store.grantSharing();
    }
    store.completeSetup();
  },
};

const dismissOutro: DriverAction = {
  id: 'dismiss_outro',
  description: 'Dismiss the outro (sets outroDismissed).',
  apply: (store) => store.setOutroDismissed(),
};

const setMcpOutcome = (description: string): DriverAction => ({
  id: 'set_mcp_outcome',
  description,
  params: {
    outcome: '"installed" | "skipped" (default skipped)',
    clients: 'string[] (optional)',
  },
  apply: (store, params) => {
    const outcome = optionalOneOf(
      'set_mcp_outcome',
      params,
      'outcome',
      ['installed', 'skipped'] as const,
      'skipped',
    );
    store.setMcpComplete(
      outcome === 'installed' ? McpOutcome.Installed : McpOutcome.Skipped,
      optionalStringArray('set_mcp_outcome', params, 'clients'),
    );
  },
});

export const GENERIC_ACTIONS: Readonly<
  Record<string, readonly DriverAction[]>
> = {
  'health-check': [
    {
      id: 'dismiss_outage',
      description: 'Dismiss the blocking outage screen and continue.',
      apply: (store) => store.dismissOutage(),
    },
  ],
  setup: [
    {
      id: 'choose',
      description:
        'Answer one setup question by committing a framework-context value. ' +
        'Read state.setupQuestions for the key and allowed values.',
      params: { key: 'setup question key', value: 'chosen option value' },
      apply: (store, params) => {
        const key = requireString('choose', params, 'key');
        const value = requireString('choose', params, 'value');
        store.setFrameworkContext(key, value);
      },
    },
  ],
  [FLOW_KEY.Outro]: [dismissOutro],
  'audit-outro': [dismissOutro],
  'source-maps-outro': [dismissOutro],
  [FLOW_KEY.MintFailure]: [
    {
      id: 'continue_setup',
      description: 'Continue to MCP and Slack after the skill is saved.',
      apply: (store) => store.setMintHandoff('continue'),
    },
    {
      id: 'dismiss_outro',
      description: 'Exit the wizard from the mint failure screen.',
      apply: (store) => store.setMintHandoff('exit'),
    },
  ],
  [FLOW_KEY.Mcp]: [
    setMcpOutcome(
      'Complete the MCP step. outcome is installed or skipped; clients optional.',
    ),
  ],
  'mcp-add': [setMcpOutcome('Complete the standalone MCP-add flow.')],
  'mcp-remove': [setMcpOutcome('Complete the standalone MCP-remove flow.')],
  'mcp-suggested-prompts': [
    {
      id: 'dismiss',
      description: 'Dismiss the suggested-prompts step.',
      apply: (store) => store.setMcpSuggestedPromptsDismissed(),
    },
  ],
  [FLOW_KEY.SlackConnect]: [
    {
      id: 'dismiss_slack',
      description: 'Skip or finish the Connect-Slack step.',
      apply: (store) => store.setSlackStepDismissed(),
    },
    {
      id: 'set_slack_connected',
      description: 'Mark Slack as connected (then dismiss to advance).',
      params: { connected: 'boolean (default true)' },
      apply: (store, params) =>
        store.setSlackConnected(
          optionalBoolean('set_slack_connected', params, 'connected', true),
        ),
    },
  ],
  [FLOW_KEY.KeepSkills]: [
    {
      id: 'keep_skills',
      description:
        'Decide whether to keep installed skills; completes the run.',
      params: { kept: 'boolean (default true)' },
      apply: (store, params) =>
        store.setSkillsComplete(
          optionalBoolean('keep_skills', params, 'kept', true),
        ),
    },
  ],
  [Interrupt.WizardAsk]: [
    {
      id: 'answer_question',
      description:
        'Resolve the pending wizard_ask request with a complete answers ' +
        'map: { [questionId]: string | string[] }. See state.session.pendingQuestion.',
      params: { answers: 'Record<questionId, string | string[]>' },
      apply: (store, params) =>
        store.resolvePendingQuestion(
          requireRecord('answer_question', params, 'answers') as AskAnswers,
        ),
    },
    {
      id: 'cancel_question',
      description: 'Cancel the pending wizard_ask request (sentinel answers).',
      apply: (store) => store.cancelPendingQuestion(),
    },
  ],
  [Interrupt.TaskNotice]: [
    {
      id: 'resolve_notice',
      description:
        'Resolve the task-notice overlay a program shows before an optional ' +
        'step. keep=true runs the step, keep=false skips it. See state.session.taskNotice.',
      params: { keep: 'boolean (default true)' },
      apply: (store, params) =>
        store.resolveTaskNotice(
          optionalBoolean('resolve_notice', params, 'keep', true),
        ),
    },
  ],
  [Interrupt.SettingsOverride]: [
    {
      id: 'backup_and_fix',
      description: 'Back up and fix conflicting .claude/settings.json.',
      apply: (store) => {
        store.backupAndFixSettingsOverride();
      },
    },
  ],
  [Interrupt.PortConflict]: [
    {
      id: 'resolve_port_conflict',
      description:
        'Dismiss the port-conflict overlay and retry the OAuth port loop.',
      apply: (store) => store.resolvePortConflict(),
    },
  ],
  [Interrupt.ManualAuthCode]: [
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

/** Every program intro shares one shape: confirm and continue. */
function isIntro(screen: string): boolean {
  return screen === 'intro' || screen.endsWith('-intro');
}

function genericActionsFor(screen: string): readonly DriverAction[] {
  if (screen === 'intro') return [confirmSetupWithSharing];
  if (isIntro(screen)) return [confirmSetup];
  return GENERIC_ACTIONS[screen] ?? [];
}

/** Actions legal on `screen` in `flow`: the flow's own first, then generic. */
export function actionsFor(flow: Flow, screen: string): DriverAction[] {
  const own = flow.steps
    .filter((step) => step.screenId === screen)
    .flatMap((step) => step.controlActions ?? []);
  const seen = new Set(own.map((a) => a.id));
  return [...own, ...genericActionsFor(screen).filter((a) => !seen.has(a.id))];
}

export function toActionView(action: DriverAction): ActionView {
  return {
    id: action.id,
    description: action.description,
    ...(action.params ? { params: action.params } : {}),
  };
}
