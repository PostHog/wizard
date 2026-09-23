/** Partial control: the commits a parent may make, as the current screen's key handler would. */
import {
  ERROR_TRACKING_PROJECT_PATH_KEY,
  FRAMEWORK_REGISTRY,
  GITHUB_REQUIRED_BODY,
  GITHUB_REQUIRED_MESSAGE,
  SELF_DRIVING_INTEGRATE_PATH_KEY,
  SOURCE_MAPS_CONTEXT_KEYS,
  VARIANT_DISPLAY_NAME,
} from '@programs';
import type { AskAnswers } from '@agent/types';
import type { Integration } from '@shared/constants';
import { OutroKind } from '@shared/outro';
import { McpOutcome } from '@shared/run-state';
import { ScanConsent } from '@shared/scan-consent';
import {
  BadParamError,
  optionalBoolean,
  optionalOneOf,
  optionalStringArray,
  requireBoolean,
  requireRecord,
  requireString,
} from '@shared/control/params';
import type { ControlAction } from '@shared/control/types';
import { Overlay } from '../router.js';
import { ScreenId } from '../screen-sequences.js';
import type { WizardStore } from '../store.js';

/** An action before it is bound to a store. */
type ActionDef = Omit<ControlAction, 'apply'> & {
  apply: (store: WizardStore, params: Record<string, unknown>) => void;
};

/** Screens with no commit: the runner or the agent advances them, or they are terminal. */
export const NO_ACTION_SCREENS: ReadonlySet<string> = new Set<string>([
  ScreenId.Auth,
  ScreenId.Run,
  ScreenId.AiOptIn,
  ScreenId.Exit,
  ScreenId.AuditRun,
  ScreenId.DoctorReport,
  Overlay.ManagedSettings,
  Overlay.AuthError,
  Overlay.SessionTimeout,
]);

const confirmSetup: ActionDef = {
  id: 'confirm_setup',
  description: 'Confirm the intro and continue (sets setupConfirmed).',
  apply: (store) => store.completeSetup(),
};

/** The default intro also decides scan sharing; Enter grants when undecided, as its key handler does. */
const confirmSetupWithSharing: ActionDef = {
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

const dismissOutro: ActionDef = {
  id: 'dismiss_outro',
  description: 'Dismiss the outro (sets outroDismissed).',
  apply: (store) => store.setOutroDismissed(),
};

const setMcpOutcome = (description: string): ActionDef => ({
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

/** Commit the project a detect screen's picker would: its path and framework. */
const pickIntegrationTarget = (pathKey: string): ActionDef => ({
  id: 'pick_integration_target',
  description:
    "Commit the project to set up, as the detect screen's picker would: " +
    'its path relative to the repo root and its framework.',
  params: {
    path: 'project path relative to the repo root ("." = root)',
    integration: 'framework id, e.g. "nextjs"',
  },
  apply: (store, params) => {
    const path = requireString('pick_integration_target', params, 'path');
    const integration = requireString(
      'pick_integration_target',
      params,
      'integration',
    ) as Integration;
    const config = FRAMEWORK_REGISTRY[integration];
    if (!config) {
      throw new BadParamError(
        'pick_integration_target',
        'integration',
        `unknown framework "${integration}"`,
      );
    }
    store.setFrameworkContext(pathKey, path);
    store.setFrameworkConfig(integration, config);
  },
});

const ACTIONS: Readonly<Record<string, readonly ActionDef[]>> = {
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
  [ScreenId.SelfDrivingIntegrationCheck]: [
    {
      id: 'set_integrate',
      description:
        'Decide whether the integration runs before Self-driving (the user already has an account).',
      params: { integrate: 'boolean' },
      apply: (store, params) =>
        store.setIntegrate(
          requireBoolean('set_integrate', params, 'integrate'),
        ),
    },
  ],
  [ScreenId.SelfDrivingIntegrationDetect]: [
    pickIntegrationTarget(SELF_DRIVING_INTEGRATE_PATH_KEY),
  ],
  [ScreenId.ErrorTrackingDetect]: [
    pickIntegrationTarget(ERROR_TRACKING_PROJECT_PATH_KEY),
  ],
  [ScreenId.SourceMapsDetect]: [
    {
      id: 'pick_source_maps_project',
      description:
        'Commit the project to upload source maps for, as the picker would: its path and SDK variant.',
      params: {
        path: 'project path relative to the repo root',
        variant: Object.keys(VARIANT_DISPLAY_NAME).join(' | '),
      },
      apply: (store, params) => {
        const path = requireString('pick_source_maps_project', params, 'path');
        const variant = requireString(
          'pick_source_maps_project',
          params,
          'variant',
        ) as keyof typeof VARIANT_DISPLAY_NAME;
        const displayName = VARIANT_DISPLAY_NAME[variant];
        if (!displayName) {
          throw new BadParamError(
            'pick_source_maps_project',
            'variant',
            `expected one of ${Object.keys(VARIANT_DISPLAY_NAME).join(', ')}`,
          );
        }
        store.setFrameworkContext(
          SOURCE_MAPS_CONTEXT_KEYS.selectedVariant,
          variant,
        );
        store.setFrameworkContext(
          SOURCE_MAPS_CONTEXT_KEYS.selectedDisplayName,
          displayName,
        );
        store.setFrameworkContext(SOURCE_MAPS_CONTEXT_KEYS.selectedPath, path);
      },
    },
  ],
  [ScreenId.SelfDrivingHandoff]: [
    {
      id: 'confirm_self_driving_handoff',
      description:
        'Confirm the handoff from the integration run to Self-driving.',
      apply: (store) => store.confirmSelfDrivingHandoff(),
    },
  ],
  [ScreenId.SelfDrivingGithub]: [
    {
      id: 'set_github_connected',
      description: 'Record the GitHub App connection the check would find.',
      params: { connected: 'boolean (default true)' },
      apply: (store, params) =>
        store.setGithubConnected(
          optionalBoolean('set_github_connected', params, 'connected', true),
        ),
    },
    {
      id: 'decline_github',
      description:
        'Answer "I can\'t connect right now": the run ends before the agent starts.',
      apply: (store) =>
        store.declineGithub({
          kind: OutroKind.Cancel,
          message: GITHUB_REQUIRED_MESSAGE,
          body: GITHUB_REQUIRED_BODY,
        }),
    },
  ],
  [ScreenId.Outro]: [dismissOutro],
  [ScreenId.AuditOutro]: [dismissOutro],
  [ScreenId.SourceMapsOutro]: [dismissOutro],
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
  [ScreenId.McpAdd]: [setMcpOutcome('Complete the standalone MCP-add flow.')],
  [ScreenId.McpRemove]: [
    setMcpOutcome('Complete the standalone MCP-remove flow.'),
  ],
  [ScreenId.McpSuggestedPrompts]: [
    {
      id: 'dismiss',
      description: 'Dismiss the suggested-prompts step.',
      apply: (store) => store.setMcpSuggestedPromptsDismissed(),
    },
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
  [Overlay.WizardAsk]: [
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
  [Overlay.TaskNotice]: [
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

/** Every program intro shares one shape: confirm and continue. */
function isIntro(screen: string): boolean {
  return screen === ScreenId.Intro || screen.endsWith('-intro');
}

/** The commits legal on `screen`, bound to `store`. */
export function actionsFor(
  store: WizardStore,
  screen: string,
): ControlAction[] {
  const defs =
    screen === ScreenId.Intro
      ? [confirmSetupWithSharing]
      : isIntro(screen)
      ? [confirmSetup]
      : ACTIONS[screen] ?? [];
  return defs.map((def) => ({
    ...def,
    apply: (params) => def.apply(store, params),
  }));
}

/** Screens with an action table, for the coverage test. */
export const SCREENS_WITH_ACTIONS: readonly string[] = Object.keys(ACTIONS);
