/**
 * Full control: one route per public WizardStore setter a parent may call by
 * name, whatever the current screen or phase: the session store's setters
 * (`SESSION_SETTERS`), the TUI's own below, and the named setters each
 * program's TUI entry adds. Writing state is not running the wizard: setting
 * the phase to completed does not finish a run, and the server lists every
 * call in `state.controlWrites`.
 */
import { PROGRAM_REGISTRY, SESSION_SETTERS } from '@programs';
import type { TokenUsageDelta } from '@agent/types';
import {
  backupAndFixClaudeSettings,
  type SettingsConflict,
} from '@shared/claude-settings';
import { McpOutcome } from '@shared/run-state';
import {
  BadParamError,
  isRecord,
  optionalBoolean,
  optionalOneOf,
  optionalStringArray,
  requireBoolean,
  requireNumber,
  requireOneOf,
  requireRecord,
  requireString,
} from '@shared/control/params';
import type { ControlSetter } from '@shared/control/types';
import { listFlowOwners } from '../flow-owner.js';
import type { SetterDef } from './defs.js';
import { Overlay } from '../router.js';
import type { WizardStore } from '../store.js';

const enumValues = <T extends string>(e: Record<string, T>): readonly T[] =>
  Object.values(e);

/** An optional string param: absent is null. */
const nullableString = (
  subject: string,
  p: Record<string, unknown>,
  key: string,
): string | null =>
  p[key] === undefined ? null : requireString(subject, p, key);

/** The MCP step's feature choice: absent, the word "all", or a list of feature ids. */
function featuresSelected(
  subject: string,
  params: Record<string, unknown>,
): 'all' | string[] | undefined {
  const v = params.featuresSelected;
  if (v === undefined || v === 'all') return v;
  if (Array.isArray(v) && v.every((f) => typeof f === 'string')) return v;
  throw new BadParamError(
    subject,
    'featuresSelected',
    'expected "all" or string[]',
  );
}

const SETTERS: readonly SetterDef[] = [
  // ── Setup ────────────────────────────────────────────────────────
  {
    name: 'completeSetup',
    description: 'Confirm the intro (setupConfirmed).',
    apply: (store) => store.completeSetup(),
  },
  {
    name: 'switchProgram',
    description:
      "Register another program's flow: its gates and screens replace the current ones.",
    params: { programId: 'a registered program id' },
    apply: (store, p) => {
      const programId = requireString('switchProgram', p, 'programId');
      if (!PROGRAM_REGISTRY.some((c) => c.id === programId)) {
        throw new BadParamError(
          'switchProgram',
          'programId',
          `unknown program "${programId}"`,
        );
      }
      store.switchProgram(programId);
    },
  },
  // ── Login ─────────────────────────────────────────────────────────
  {
    name: 'setLoginUrl',
    description:
      'The localhost login URL the auth screen shows; absent clears it.',
    params: { url: 'string (optional)' },
    apply: (store, p) =>
      store.setLoginUrl(nullableString('setLoginUrl', p, 'url')),
  },
  {
    name: 'setAuthorizeUrl',
    description:
      'The direct authorize URL the manual-paste modal shows; absent clears it.',
    params: { url: 'string (optional)' },
    apply: (store, p) =>
      store.setAuthorizeUrl(nullableString('setAuthorizeUrl', p, 'url')),
  },
  // ── Composition choices ─────────────────────────────────────────
  {
    name: 'completeRunStep',
    description:
      "Record a composed run step (e.g. self-driving's integrate-run) as done.",
    params: { stepId: 'string' },
    apply: (store, p) =>
      store.completeRunStep(requireString('completeRunStep', p, 'stepId')),
  },
  // ── Readiness and overlays ──────────────────────────────────────
  {
    name: 'showSettingsOverride',
    description:
      "Open the settings-override overlay for these conflicts; its fix backs up the session's project settings.",
    params: { conflicts: '[{ source, path, keys, ... }]' },
    apply: (store, p) => {
      const v = p.conflicts;
      if (
        !Array.isArray(v) ||
        !v.every((c) => isRecord(c) && Array.isArray(c.keys))
      ) {
        throw new BadParamError(
          'showSettingsOverride',
          'conflicts',
          'expected [{ source, path, keys }]',
        );
      }
      void store.showSettingsOverride(v as SettingsConflict[], () =>
        backupAndFixClaudeSettings(store.session.installDir),
      );
    },
  },
  {
    name: 'showPortConflict',
    description:
      'Open the port-conflict overlay; resolvePortConflict answers it.',
    params: {
      command: 'string',
      pid: 'string',
      port: 'number',
      user: 'string',
    },
    apply: (store, p) => {
      const S = 'showPortConflict';
      void store.showPortConflict({
        command: requireString(S, p, 'command'),
        pid: requireString(S, p, 'pid'),
        port: requireNumber(S, p, 'port'),
        user: requireString(S, p, 'user'),
      });
    },
  },
  {
    name: 'dismissOutage',
    description: 'Dismiss the blocking outage screen.',
    apply: (store) => store.dismissOutage(),
  },
  {
    name: 'resolvePortConflict',
    description:
      'Dismiss the port-conflict overlay and retry the OAuth port loop.',
    apply: (store) => store.resolvePortConflict(),
  },
  {
    name: 'showManualAuthCode',
    description: 'Open the manual auth-code overlay.',
    apply: (store) => store.showManualAuthCode(),
  },
  {
    name: 'submitManualAuthCode',
    description: 'Submit a manually-entered OAuth authorization code.',
    params: { code: 'string' },
    apply: (store, p) =>
      store.submitManualAuthCode(
        requireString('submitManualAuthCode', p, 'code'),
      ),
  },
  {
    name: 'dismissManualAuthCode',
    description: 'Dismiss the manual auth-code overlay.',
    apply: (store) => store.dismissManualAuthCode(),
  },
  {
    name: 'backupAndFixSettingsOverride',
    description:
      'Back up and fix conflicting .claude/settings.json (writes files).',
    apply: (store) => {
      store.backupAndFixSettingsOverride();
    },
  },
  {
    name: 'showAuthError',
    description: 'Open the auth-error overlay.',
    params: { detail: 'AuthErrorDetail (optional)' },
    apply: (store, p) =>
      store.showAuthError(
        p.detail === undefined
          ? undefined
          : (requireRecord('showAuthError', p, 'detail') as never),
      ),
  },
  {
    name: 'showSessionTimeout',
    description: 'Open the session-timeout overlay.',
    apply: (store) => store.showSessionTimeout(),
  },
  {
    name: 'pushOverlay',
    description: 'Push an overlay screen.',
    params: { overlay: enumValues(Overlay).join(' | ') },
    apply: (store, p) =>
      store.pushOverlay(
        requireOneOf('pushOverlay', p, 'overlay', enumValues(Overlay)),
      ),
  },
  {
    name: 'popOverlay',
    description: 'Pop the top overlay screen.',
    apply: (store) => store.popOverlay(),
  },
  // ── Run progress the TUI shows ───────────────────────────────────
  {
    name: 'setCurrentStage',
    description: 'The current stage of work (an agent phase name).',
    params: { stage: 'string' },
    apply: (store, p) =>
      store.setCurrentStage(requireString('setCurrentStage', p, 'stage')),
  },
  {
    name: 'addTokenUsage',
    description: "Accumulate one assistant turn's token usage.",
    params: {
      inputTokens: 'number',
      outputTokens: 'number',
      cacheReadTokens: 'number',
      cacheCreationTokens: 'number',
      cacheCreation5m: 'number',
      cacheCreation1h: 'number',
      model: 'string (optional)',
    },
    apply: (store, p) => {
      const S = 'addTokenUsage';
      const delta: TokenUsageDelta = {
        inputTokens: requireNumber(S, p, 'inputTokens'),
        outputTokens: requireNumber(S, p, 'outputTokens'),
        cacheReadTokens: requireNumber(S, p, 'cacheReadTokens'),
        cacheCreationTokens: requireNumber(S, p, 'cacheCreationTokens'),
        cacheCreation5m: requireNumber(S, p, 'cacheCreation5m'),
        cacheCreation1h: requireNumber(S, p, 'cacheCreation1h'),
        ...(p.model === undefined
          ? {}
          : { model: requireString(S, p, 'model') }),
      };
      store.addTokenUsage(delta);
    },
  },
  {
    name: 'setFinalTokenCostUsd',
    description: "Reconcile the run's cost to the SDK's total.",
    params: { costUsd: 'number' },
    apply: (store, p) =>
      store.setFinalTokenCostUsd(
        requireNumber('setFinalTokenCostUsd', p, 'costUsd'),
      ),
  },
  // ── Follow-up steps ──────────────────────────────────────────────
  {
    name: 'setMcpComplete',
    description: 'Complete the MCP step.',
    params: {
      outcome: `${enumValues(McpOutcome).join(' | ')} (default skipped)`,
      installedClients: 'string[] (optional)',
      featuresSelected: '"all" | string[] (optional)',
      loginCommands: 'string[] (optional)',
    },
    apply: (store, p) => {
      const S = 'setMcpComplete';
      store.setMcpComplete(
        optionalOneOf(
          S,
          p,
          'outcome',
          enumValues(McpOutcome),
          McpOutcome.Skipped,
        ),
        optionalStringArray(S, p, 'installedClients'),
        featuresSelected(S, p),
        optionalStringArray(S, p, 'loginCommands'),
      );
    },
  },
  {
    name: 'setSkillsComplete',
    description: 'Complete the keep-skills step.',
    params: { kept: 'boolean (default true)' },
    apply: (store, p) =>
      store.setSkillsComplete(
        optionalBoolean('setSkillsComplete', p, 'kept', true),
      ),
  },
  {
    name: 'setSlackStepDismissed',
    description: 'Skip or finish the Connect-Slack step.',
    apply: (store) => store.setSlackStepDismissed(),
  },
  {
    name: 'setSlackConnected',
    description: 'Mark Slack connected.',
    params: { connected: 'boolean (default true)' },
    apply: (store, p) =>
      store.setSlackConnected(
        optionalBoolean('setSlackConnected', p, 'connected', true),
      ),
  },
  {
    name: 'setOutroDismissed',
    description: 'Dismiss the outro of the active run.',
    params: { dismissed: 'boolean (default true)' },
    apply: (store, p) =>
      store.setOutroDismissed(
        optionalBoolean('setOutroDismissed', p, 'dismissed', true),
      ),
  },
  {
    name: 'setMintHandoff',
    description:
      'Decide the failed-run handoff: continue to the follow-ups or exit.',
    params: { action: 'continue | exit' },
    apply: (store, p) =>
      store.setMintHandoff(
        requireOneOf('setMintHandoff', p, 'action', [
          'continue',
          'exit',
        ] as const),
      ),
  },
  {
    name: 'setSpellbook',
    description: 'The skill saved for the user during the handoff.',
    params: { path: 'string', skillsIncluded: 'boolean' },
    apply: (store, p) =>
      store.setSpellbook({
        path: requireString('setSpellbook', p, 'path'),
        skillsIncluded: requireBoolean('setSpellbook', p, 'skillsIncluded'),
      }),
  },
  // ── Presentation ─────────────────────────────────────────────────
  {
    name: 'setStatusExpanded',
    description: 'Expand or collapse the status panel.',
    params: { expanded: 'boolean' },
    apply: (store, p) =>
      store.setStatusExpanded(
        requireBoolean('setStatusExpanded', p, 'expanded'),
      ),
  },
  {
    name: 'toggleStatusExpanded',
    description: 'Toggle the status panel.',
    apply: (store) => store.toggleStatusExpanded(),
  },
  {
    name: 'toggleTokenHud',
    description: 'Toggle the token/cost HUD.',
    apply: (store) => store.toggleTokenHud(),
  },
  {
    name: 'setLearnCardBlockIdx',
    description: 'The learn card page.',
    params: { idx: 'number' },
    apply: (store, p) =>
      store.setLearnCardBlockIdx(
        requireNumber('setLearnCardBlockIdx', p, 'idx'),
      ),
  },
  {
    name: 'setLearnCardComplete',
    description: 'Mark the learn card read.',
    apply: (store) => store.setLearnCardComplete(),
  },
];

/**
 * Public WizardStore members full control does not route, with why. Everything
 * else public is a setter above; the coverage test holds the two lists to the
 * store's actual members.
 */
export const NOT_SETTERS: Readonly<Record<string, string>> = {
  constructor: 'not a member call',
  runInitHooks: 'lifecycle: the TUI starts it once screens render',
  runReadyHooks: 'lifecycle: POST /detect runs detection',
  getGate: 'read: returns a promise the runner awaits',
  waitUntil: 'read: takes a predicate function',
  reachStep:
    'a wait, not a write: resolves when the flow reaches a step; runProgram asks it through the workflow',
  getVersion: 'read',
  getSnapshot: 'read',
  subscribe: 'read: takes a listener function',
  emitChange: 'notification, not state: every setter already emits',
  onEnterScreen: 'takes a callback function',
  showOutroError:
    'composite: setOutroData plus the Error run phase, both routed on their own',
  waitForManualAuthCode:
    'a wait, not a write: returns the promise the OAuth flow awaits; submitManualAuthCode answers it',
  updateTuiState:
    "a raw state write: each program routes its own named setters (TUI entry's `setters`)",
  launch: 'lifecycle: the host sets the session and the launch choices once',
  requestExit: 'ends the run, not state: POST /shutdown ends a controlled run',
};

/** The setters programs and tools add through their TUI entries, first of each name. */
function programSetters(): SetterDef[] {
  const seen = new Set(SETTERS.map((s) => s.name));
  const defs: SetterDef[] = [];
  for (const program of listFlowOwners()) {
    for (const def of program.setters ?? []) {
      if (seen.has(def.name)) continue;
      seen.add(def.name);
      defs.push(def);
    }
  }
  return defs;
}

/** Every setter full control routes, the store's and the programs', bound to `store`. */
export function settersFor(store: WizardStore): ControlSetter[] {
  return [
    ...SESSION_SETTERS.map((def) => ({
      ...def,
      apply: (params: Record<string, unknown>) =>
        def.apply(store.sessions, params),
    })),
    ...[...SETTERS, ...programSetters()].map((def) => ({
      ...def,
      apply: (params: Record<string, unknown>) => def.apply(store, params),
    })),
  ];
}

/** The routed store setter names, for the coverage test. */
export const SETTER_NAMES: readonly string[] = [
  ...SESSION_SETTERS,
  ...SETTERS,
].map((s) => s.name);

/** The routed program setter names, for the coverage test. */
export function programSetterNames(): readonly string[] {
  return programSetters().map((s) => s.name);
}
