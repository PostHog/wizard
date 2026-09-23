/**
 * Full control: one route per public WizardStore setter a parent may call by
 * name, whatever the current screen or phase. Writing state is not running
 * the wizard: setting the phase to completed does not finish a run, and the
 * server lists every call in `state.controlWrites`.
 */
import { FRAMEWORK_REGISTRY, PROGRAM_REGISTRY } from '@programs';
import type {
  AskAnswers,
  OutroData,
  PendingQuestion,
  TaskNotice,
  TokenUsageDelta,
} from '@agent/types';
import type { ApiUser } from '@shared/posthog/api';
import { HostResolution } from '@shared/posthog/host-resolution';
import {
  backupAndFixClaudeSettings,
  type SettingsConflict,
} from '@shared/claude/claude-settings';
import {
  WizardReadiness,
  type WizardReadinessResult,
} from '@shared/health-checks/readiness';
import { AdditionalFeature, type Integration } from '@shared/config/constants';
import { OutroKind } from '@shared/run/outro';
import { McpOutcome, RunPhase, TaskStatus } from '@shared/run/run-state';
import { DiscoveredFeature } from '@shared/run/scan-consent';
import {
  BadParamError,
  MissingParamError,
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
import { Overlay } from '../app/router.js';
import type { WizardStore } from '../state/store.js';

/** A setter before it is bound to a store. */
type SetterDef = Omit<ControlSetter, 'apply'> & {
  apply: (store: WizardStore, params: Record<string, unknown>) => void;
};

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

/** An outro payload: `kind` must be one of the outro kinds; other fields pass as given. */
function outroData(subject: string, p: Record<string, unknown>): OutroData {
  const data = requireRecord(subject, p, 'data');
  requireOneOf(subject, data, 'kind', enumValues(OutroKind));
  return data as unknown as OutroData;
}

/** A todo list as the agent reports it: content, status, optional activeForm. */
function todos(
  subject: string,
  p: Record<string, unknown>,
): Array<{ content: string; status: string; activeForm?: string }> {
  const v = p.todos;
  if (v === undefined) throw new MissingParamError(subject, 'todos');
  if (
    !Array.isArray(v) ||
    !v.every(
      (t) =>
        isRecord(t) &&
        typeof t.content === 'string' &&
        typeof t.status === 'string',
    )
  ) {
    throw new BadParamError(subject, 'todos', 'expected [{ content, status }]');
  }
  return v as Array<{ content: string; status: string; activeForm?: string }>;
}

/** Project credentials a parent already holds; the state only shows hasCredentials and projectId. */
function credentials(subject: string, p: Record<string, unknown>) {
  const apiHost = requireString(subject, p, 'apiHost');
  try {
    new URL(apiHost);
  } catch {
    throw new BadParamError(subject, 'apiHost', 'expected an absolute URL');
  }
  return {
    accessToken: requireString(subject, p, 'accessToken'),
    projectApiKey: requireString(subject, p, 'projectApiKey'),
    projectId: requireNumber(subject, p, 'projectId'),
    host: HostResolution.fromApiHost(apiHost),
  };
}

const CREDENTIAL_PARAMS = {
  accessToken: 'string',
  projectApiKey: 'string',
  projectId: 'number',
  apiHost: 'absolute URL, e.g. https://us.posthog.com',
};

const SETTERS: readonly SetterDef[] = [
  // ── Setup and consent ────────────────────────────────────────────
  {
    name: 'completeSetup',
    description: 'Confirm the intro (setupConfirmed).',
    apply: (store) => store.completeSetup(),
  },
  {
    name: 'grantSharing',
    description: 'Grant sharing of scan results.',
    apply: (store) => store.grantSharing(),
  },
  {
    name: 'declineSharing',
    description: 'Decline sharing of scan results.',
    apply: (store) => store.declineSharing(),
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
    name: 'setCredentials',
    description:
      'Commit project credentials the parent already holds; the state only ever shows hasCredentials and projectId.',
    params: CREDENTIAL_PARAMS,
    apply: (store, p) => store.setCredentials(credentials('setCredentials', p)),
  },
  {
    name: 'setAccessToken',
    description:
      'Replace the credentials as a token refresh does (no auth-complete event).',
    params: CREDENTIAL_PARAMS,
    apply: (store, p) => store.setAccessToken(credentials('setAccessToken', p)),
  },
  {
    name: 'setApiUser',
    description:
      'The /api/users/@me/ record (e.g. organization.is_ai_data_processing_approved for the AI opt-in gate); absent clears it. Never read back over the socket.',
    params: { user: 'ApiUser record (optional)' },
    apply: (store, p) =>
      store.setApiUser(
        p.user === undefined
          ? null
          : (requireRecord('setApiUser', p, 'user') as unknown as ApiUser),
      ),
  },
  {
    name: 'setRoleAtOrganization',
    description: "The user's role; absent clears it.",
    params: { role: 'string (optional)' },
    apply: (store, p) =>
      store.setRoleAtOrganization(
        nullableString('setRoleAtOrganization', p, 'role'),
      ),
  },
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
  {
    name: 'chooseProvisionAccount',
    description:
      'Self-driving: provision a new account on auth (sets signup, email, region and integrate).',
    params: { email: 'string', region: '"us" | "eu"' },
    apply: (store, p) =>
      store.chooseProvisionAccount(
        requireString('chooseProvisionAccount', p, 'email'),
        requireOneOf('chooseProvisionAccount', p, 'region', [
          'us',
          'eu',
        ] as const),
      ),
  },
  // ── Detection ─────────────────────────────────────────────────────
  {
    name: 'setFrameworkConfig',
    description:
      'Pick the framework by id, as detection would (integration + frameworkConfig from the registry).',
    params: { integration: 'framework id, e.g. "nextjs"' },
    apply: (store, p) => {
      const integration = requireString(
        'setFrameworkConfig',
        p,
        'integration',
      ) as Integration;
      const config = FRAMEWORK_REGISTRY[integration];
      if (!config) {
        throw new BadParamError(
          'setFrameworkConfig',
          'integration',
          `unknown framework "${integration}"`,
        );
      }
      store.setFrameworkConfig(integration, config);
    },
  },
  {
    name: 'setDetectedFramework',
    description: 'The human label detection shows (detectedFrameworkLabel).',
    params: { label: 'string' },
    apply: (store, p) =>
      store.setDetectedFramework(
        requireString('setDetectedFramework', p, 'label'),
      ),
  },
  {
    name: 'setDetectionComplete',
    description: 'Mark detection done so detect screens advance.',
    apply: (store) => store.setDetectionComplete(),
  },
  {
    name: 'setPosthogSdkDetected',
    description: 'Whether detection found PostHog in the project dependencies.',
    params: { detected: 'boolean' },
    apply: (store, p) =>
      store.setPosthogSdkDetected(
        requireBoolean('setPosthogSdkDetected', p, 'detected'),
      ),
  },
  {
    name: 'setUnsupportedVersion',
    description: 'The framework version detection found too old.',
    params: { current: 'string', minimum: 'string', docsUrl: 'string' },
    apply: (store, p) =>
      store.setUnsupportedVersion({
        current: requireString('setUnsupportedVersion', p, 'current'),
        minimum: requireString('setUnsupportedVersion', p, 'minimum'),
        docsUrl: requireString('setUnsupportedVersion', p, 'docsUrl'),
      }),
  },
  {
    name: 'setSkillId',
    description: 'The skill the run installs; absent clears it.',
    params: { skillId: 'string (optional)' },
    apply: (store, p) =>
      store.setSkillId(nullableString('setSkillId', p, 'skillId')),
  },
  {
    name: 'addDiscoveredFeature',
    description: 'Record a feature discovery would have found.',
    params: { feature: enumValues(DiscoveredFeature).join(' | ') },
    apply: (store, p) =>
      store.addDiscoveredFeature(
        requireOneOf(
          'addDiscoveredFeature',
          p,
          'feature',
          enumValues(DiscoveredFeature),
        ),
      ),
  },
  {
    name: 'setFrameworkContext',
    description:
      'Commit one framework-context value (what detect and picker screens write); value is any JSON.',
    params: { key: 'string', value: 'JSON value' },
    apply: (store, p) => {
      const key = requireString('setFrameworkContext', p, 'key');
      if (!('value' in p))
        throw new MissingParamError('setFrameworkContext', 'value');
      store.setFrameworkContext(key, p.value);
    },
  },
  // ── Composition choices ─────────────────────────────────────────
  {
    name: 'setIntegrate',
    description: 'Self-driving: whether to run the integration first.',
    params: { integrate: 'boolean' },
    apply: (store, p) =>
      store.setIntegrate(requireBoolean('setIntegrate', p, 'integrate')),
  },
  {
    name: 'enableFeature',
    description:
      'Queue an additional feature for the run (llm also sets llmOptIn).',
    params: { feature: enumValues(AdditionalFeature).join(' | ') },
    apply: (store, p) =>
      store.enableFeature(
        requireOneOf(
          'enableFeature',
          p,
          'feature',
          enumValues(AdditionalFeature),
        ),
      ),
  },
  {
    name: 'completeRunStep',
    description:
      "Record a composed run step (e.g. self-driving's integrate-run) as done.",
    params: { stepId: 'string' },
    apply: (store, p) =>
      store.completeRunStep(requireString('completeRunStep', p, 'stepId')),
  },
  {
    name: 'confirmSelfDrivingHandoff',
    description: 'Confirm the self-driving handoff screen.',
    apply: (store) => store.confirmSelfDrivingHandoff(),
  },
  {
    name: 'setGithubConnected',
    description: 'Mark GitHub connected.',
    params: { connected: 'boolean (default true)' },
    apply: (store, p) =>
      store.setGithubConnected(
        optionalBoolean('setGithubConnected', p, 'connected', true),
      ),
  },
  {
    name: 'declineGithub',
    description: 'Decline the GitHub connection and end on this outro.',
    params: { data: 'OutroData ({ kind, message?, body?, ... })' },
    apply: (store, p) => store.declineGithub(outroData('declineGithub', p)),
  },
  // ── Readiness and overlays ──────────────────────────────────────
  {
    name: 'setReadinessResult',
    description:
      'The pre-flight readiness result the health-check screen reads; absent clears it.',
    params: { result: '{ decision, health, reasons } (optional)' },
    apply: (store, p) => {
      if (p.result === undefined) return store.setReadinessResult(null);
      const result = requireRecord('setReadinessResult', p, 'result');
      requireOneOf(
        'setReadinessResult',
        result,
        'decision',
        enumValues(WizardReadiness),
      );
      store.setReadinessResult(result as unknown as WizardReadinessResult);
    },
  },
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
  // ── Pending requests ─────────────────────────────────────────────
  {
    name: 'requestQuestion',
    description:
      'Open the wizard_ask overlay with this request; resolvePendingQuestion or cancelPendingQuestion answers it.',
    params: { question: 'PendingQuestion ({ id, questions: [...] })' },
    apply: (store, p) => {
      const question = requireRecord('requestQuestion', p, 'question');
      requireString('requestQuestion', question, 'id');
      if (!Array.isArray(question.questions)) {
        throw new BadParamError(
          'requestQuestion',
          'question',
          'expected questions: [...]',
        );
      }
      void store.requestQuestion(question as unknown as PendingQuestion);
    },
  },
  {
    name: 'showTaskNotice',
    description: 'Open the task-notice overlay; resolveTaskNotice answers it.',
    params: { notice: 'TaskNotice ({ title, body, ... })' },
    apply: (store, p) =>
      void store.showTaskNotice(
        requireRecord('showTaskNotice', p, 'notice') as unknown as TaskNotice,
      ),
  },
  {
    name: 'resolvePendingQuestion',
    description:
      'Answer the pending wizard_ask request: { [questionId]: string | string[] }.',
    params: { answers: 'Record<questionId, string | string[]>' },
    apply: (store, p) => {
      const answers = requireRecord('resolvePendingQuestion', p, 'answers');
      for (const [id, value] of Object.entries(answers)) {
        const ok =
          typeof value === 'string' ||
          (Array.isArray(value) && value.every((v) => typeof v === 'string'));
        if (!ok) {
          throw new BadParamError(
            'resolvePendingQuestion',
            'answers',
            `"${id}" must be a string or string[]`,
          );
        }
      }
      store.resolvePendingQuestion(answers as AskAnswers);
    },
  },
  {
    name: 'cancelPendingQuestion',
    description: 'Cancel the pending wizard_ask request (sentinel answers).',
    apply: (store) => store.cancelPendingQuestion(),
  },
  {
    name: 'resolveTaskNotice',
    description:
      'Resolve the task-notice overlay: keep runs the step, false skips it.',
    params: { keep: 'boolean (default true)' },
    apply: (store, p) =>
      store.resolveTaskNotice(
        optionalBoolean('resolveTaskNotice', p, 'keep', true),
      ),
  },
  // ── Run progress: what the agent reports ─────────────────────────
  {
    name: 'setRunPhase',
    description:
      'The run phase. Writing completed does not finish a run; only POST /runs records one.',
    params: { phase: enumValues(RunPhase).join(' | ') },
    apply: (store, p) =>
      store.setRunPhase(
        requireOneOf('setRunPhase', p, 'phase', enumValues(RunPhase)),
      ),
  },
  {
    name: 'syncTodos',
    description: 'Replace the task list as the agent reports it.',
    params: {
      todos: `[{ content, status: ${enumValues(TaskStatus).join(
        ' | ',
      )}, activeForm? }]`,
    },
    apply: (store, p) => store.syncTodos(todos('syncTodos', p)),
  },
  {
    name: 'setTasks',
    description: 'Replace the task list verbatim.',
    params: {
      tasks: `[{ label, status: ${enumValues(TaskStatus).join(' | ')} }]`,
    },
    apply: (store, p) => {
      const v = p.tasks;
      if (
        !Array.isArray(v) ||
        !v.every((t) => isRecord(t) && typeof t.label === 'string')
      ) {
        throw new BadParamError(
          'setTasks',
          'tasks',
          'expected [{ label, status }]',
        );
      }
      store.setTasks(
        v.map((t: Record<string, unknown>) => {
          const status = requireOneOf(
            'setTasks',
            t,
            'status',
            enumValues(TaskStatus),
          );
          return {
            label: t.label as string,
            status,
            done: status === TaskStatus.Completed,
          };
        }),
      );
    },
  },
  {
    name: 'updateTask',
    description: 'Mark one task done or pending by index.',
    params: { index: 'number', done: 'boolean' },
    apply: (store, p) =>
      store.updateTask(
        requireNumber('updateTask', p, 'index'),
        requireBoolean('updateTask', p, 'done'),
      ),
  },
  {
    name: 'pushStatus',
    description: 'Append one status message.',
    params: { message: 'string' },
    apply: (store, p) =>
      store.pushStatus(requireString('pushStatus', p, 'message')),
  },
  {
    name: 'setCurrentStage',
    description: 'The current stage of work (an agent phase name).',
    params: { stage: 'string' },
    apply: (store, p) =>
      store.setCurrentStage(requireString('setCurrentStage', p, 'stage')),
  },
  {
    name: 'setEventPlan',
    description: 'The event plan the agent wrote.',
    params: { events: '[{ name, description }]' },
    apply: (store, p) => {
      const v = p.events;
      if (
        !Array.isArray(v) ||
        !v.every(
          (e) =>
            isRecord(e) &&
            typeof e.name === 'string' &&
            typeof e.description === 'string',
        )
      ) {
        throw new BadParamError(
          'setEventPlan',
          'events',
          'expected [{ name, description }]',
        );
      }
      store.setEventPlan(v as Array<{ name: string; description: string }>);
    },
  },
  {
    name: 'setHandoffText',
    description: 'The handoff document the publish_handoff tool reports.',
    params: { text: 'string' },
    apply: (store, p) =>
      store.setHandoffText(requireString('setHandoffText', p, 'text')),
  },
  {
    name: 'setDashboardUrl',
    description: 'The dashboard URL the agent emitted.',
    params: { url: 'string' },
    apply: (store, p) =>
      store.setDashboardUrl(requireString('setDashboardUrl', p, 'url')),
  },
  {
    name: 'setNotebookUrl',
    description: 'The notebook URL the agent emitted.',
    params: { url: 'string' },
    apply: (store, p) =>
      store.setNotebookUrl(requireString('setNotebookUrl', p, 'url')),
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
  {
    name: 'setOutroData',
    description: 'The outro payload.',
    params: { data: 'OutroData ({ kind, message?, body?, ... })' },
    apply: (store, p) => store.setOutroData(outroData('setOutroData', p)),
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
    name: 'setMcpSuggestedPromptsDismissed',
    description: 'Dismiss the suggested-prompts step.',
    apply: (store) => store.setMcpSuggestedPromptsDismissed(),
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
  getVersion: 'read',
  getSnapshot: 'read',
  subscribe: 'read: takes a listener function',
  emitChange: 'notification, not state: every setter already emits',
  onEnterScreen: 'takes a callback function',
  setInferenceAuth:
    'takes a provider object with methods, which JSON cannot carry; POST /credentials resolves auth',
  waitForManualAuthCode:
    'a wait, not a write: returns the promise the OAuth flow awaits; submitManualAuthCode answers it',
};

/** Every setter full control routes, bound to `store`. */
export function settersFor(store: WizardStore): ControlSetter[] {
  return SETTERS.map((def) => ({
    ...def,
    apply: (params) => def.apply(store, params),
  }));
}

/** The routed setter names, for the coverage test. */
export const SETTER_NAMES: readonly string[] = SETTERS.map((s) => s.name);
