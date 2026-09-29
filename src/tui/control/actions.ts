/**
 * Partial control: the commits a parent may make, as the current screen's key
 * handler would. The core lists its own screens here; each program's screens
 * bring their commits through its TUI entry (`actions`).
 */
import { ANSWER_ACTIONS } from '@programs';
import type { SessionActionDef } from '@programs/types';
import {
  optionalBoolean,
  requireString,
  BadParamError,
} from '@shared/control/params';
import type { ControlAction } from '@shared/control/types';
import { listFlowOwners } from '../flow-owner.js';
import { Overlay } from '../router.js';
import { ScreenId } from '../screen-sequences.js';
import type { WizardStore } from '../store.js';
import {
  confirmSetup,
  dismissOutro,
  setMcpOutcome,
  type ActionDef,
} from './defs.js';

/** Core screens with no commit: the runner or the agent advances them, or they are terminal. */
const CORE_NO_ACTION_SCREENS: readonly string[] = [
  ScreenId.Auth,
  ScreenId.Run,
  ScreenId.AiOptIn,
  ScreenId.Exit,
  Overlay.ManagedSettings,
  Overlay.AuthError,
  Overlay.SessionTimeout,
];

/** Session answers, committed to the TUI store's session store. */
const onSessions = (defs: readonly SessionActionDef[]): ActionDef[] =>
  defs.map((def) => ({
    ...def,
    apply: (store, params) => def.apply(store.sessions, params),
  }));

const CORE_ACTIONS: Readonly<Record<string, readonly ActionDef[]>> = {
  [ScreenId.HealthCheck]: [
    {
      id: 'dismiss_outage',
      description: 'Dismiss the blocking outage screen and continue.',
      apply: (store) => store.dismissOutage(),
    },
  ],
  [ScreenId.Setup]: [
    {
      id: 'choose',
      description:
        'Answer one setup question by committing a framework-context value. ' +
        'Read state.setupQuestions for the key and allowed values.',
      params: { key: 'setup question key', value: 'chosen option value' },
      apply: (store, params) => {
        const key = requireString('choose', params, 'key');
        const value = requireString('choose', params, 'value');
        const question =
          store.session.frameworkConfig?.metadata.setup?.questions.find(
            (q) => q.key === key,
          );
        if (!question) {
          throw new BadParamError(
            'choose',
            'key',
            `no setup question "${key}"`,
          );
        }
        if (!question.options.some((o) => o.value === value)) {
          throw new BadParamError(
            'choose',
            'value',
            `expected one of ${question.options
              .map((o) => o.value)
              .join(', ')}`,
          );
        }
        store.setFrameworkContext(key, value);
      },
    },
  ],
  [ScreenId.Outro]: [dismissOutro],
  [ScreenId.MintFailure]: [
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
  [ScreenId.Mcp]: [
    setMcpOutcome(
      'Complete the MCP step. outcome is installed or skipped; clients optional.',
    ),
  ],
  [ScreenId.SlackConnect]: [
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
  [ScreenId.KeepSkills]: [
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
  [Overlay.WizardAsk]: onSessions(ANSWER_ACTIONS['wizard-ask']),
  [Overlay.TaskNotice]: onSessions(ANSWER_ACTIONS['task-notice']),
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

/** Every program's and tool's commits, by screen id: its TUI entry's `actions`. */
function programActions(): Record<string, readonly ActionDef[]> {
  const table: Record<string, readonly ActionDef[]> = {};
  for (const program of listFlowOwners()) {
    for (const [screen, defs] of Object.entries(program.actions ?? {})) {
      table[screen] ??= defs;
    }
  }
  return table;
}

/** Every screen's commits, core and program. */
function allActions(): Record<string, readonly ActionDef[]> {
  return { ...programActions(), ...CORE_ACTIONS };
}

/** An intro no table names shares one shape: confirm and continue. */
function isIntro(screen: string): boolean {
  return screen.endsWith('-intro');
}

/** The commits legal on `screen`, bound to `store`. */
export function actionsFor(
  store: WizardStore,
  screen: string,
): ControlAction[] {
  const defs = allActions()[screen] ?? (isIntro(screen) ? [confirmSetup] : []);
  return defs.map((def) => ({
    ...def,
    apply: (params) => def.apply(store, params),
  }));
}

/** Screens with at least one commit, for the coverage test. */
export function screensWithActions(): readonly string[] {
  return Object.entries(allActions())
    .filter(([, defs]) => defs.length > 0)
    .map(([screen]) => screen);
}

/** Screens with no commit on purpose, core and program, for the coverage test. */
export function noActionScreens(): ReadonlySet<string> {
  const none = Object.entries(allActions())
    .filter(([, defs]) => defs.length === 0)
    .map(([screen]) => screen);
  return new Set([...CORE_NO_ACTION_SCREENS, ...none]);
}
