/**
 * The session store's control surface: the state a control client reads, the
 * answers it may commit, and the setters full control may call. Headless
 * serves exactly this; the TUI adds its screens, overlays and display state.
 * Writing state is not running the wizard: setting the phase to completed does
 * not finish a run, and the server lists every setter call in `controlWrites`.
 */
import type { AskAnswers, PendingQuestion, TaskNotice } from '@agent/types';
import type { ApiUser } from '@shared/api';
import type { Integration } from '@shared/constants';
import {
  BadParamError,
  MissingParamError,
  isRecord,
  optionalBoolean,
  requireBoolean,
  requireNumber,
  requireOneOf,
  requireRecord,
  requireString,
} from '@shared/control/params';
import { redactContext } from '@shared/control/redact';
import type {
  ControlAction,
  ControlSetter,
  ControlState,
  ControlTarget,
} from '@shared/control/types';
import { DiscoveredFeature } from '@shared/discovered-feature';
import { sanitizeErrorDetail } from '@shared/errors';
import {
  WizardReadiness,
  type WizardReadinessResult,
} from '@shared/health-checks/readiness';
import { HostResolution } from '@shared/host-resolution';
import { OutroKind, type OutroData } from '@shared/outro';
import { RunPhase } from '@shared/run-state';
import { TaskStatus } from '@shared/task-status';
import { FRAMEWORK_REGISTRY } from '../frameworks/registry';
import type { SessionStore } from './session-store';
import type { WizardSession } from './wizard-session';

/** An action before it is bound to a store. */
export type SessionActionDef = Omit<ControlAction, 'apply'> & {
  apply: (store: SessionStore, params: Record<string, unknown>) => void;
};

/** A setter before it is bound to a store. */
export type SessionSetterDef = Omit<ControlSetter, 'apply'> & {
  apply: (store: SessionStore, params: Record<string, unknown>) => void;
};

/** The session fields a parent may read; everything else stays in the process. */
const SESSION_CONTROL_KEYS = [
  'installDir',
  'integration',
  'detectedFrameworkLabel',
  'detectionComplete',
  'frameworkContext',
  'discoveredFeatures',
  'runPhase',
  'pendingQuestion',
  'taskNotice',
  'outroData',
  'dashboardUrl',
  'notebookUrl',
] as const satisfies readonly (keyof WizardSession)[];

/** Project the committed store for a parent: the session's readable fields, then the host's own `hostFields`; the server adds the rest. */
export function projectControlState(
  store: SessionStore,
  currentScreen: string | null,
  version: number = store.getVersion(),
  hostFields: Record<string, unknown> = {},
): Omit<ControlState, 'mode' | 'actions' | 'controlWrites'> {
  const s = store.session;
  const questions = s.frameworkConfig?.metadata.setup?.questions ?? [];
  return {
    version,
    currentScreen,
    session: {
      ...Object.fromEntries(SESSION_CONTROL_KEYS.map((key) => [key, s[key]])),
      ...hostFields,
      frameworkContext: redactContext(s.frameworkContext),
      outroData: s.outroData
        ? {
            ...s.outroData,
            ...(s.outroData.errorDetail
              ? { errorDetail: sanitizeErrorDetail(s.outroData.errorDetail) }
              : {}),
          }
        : null,
      hasCredentials: s.credentials !== null,
      projectId: s.credentials?.projectId ?? null,
    },
    tasks: store.tasks.map((t) => ({ label: t.label, status: t.status })),
    statusMessages: [...store.statusMessages],
    eventPlan: [...store.eventPlan],
    handoffText: store.handoffText,
    setupQuestions: questions
      .filter((q) => !(q.key in s.frameworkContext))
      .map((q) => ({ key: q.key, message: q.message, options: q.options })),
  };
}

/** The answers a parent commits to a request the agent is waiting on, by the overlay it raises. */
export const ANSWER_ACTIONS: Readonly<
  Record<'wizard-ask' | 'task-notice', readonly SessionActionDef[]>
> = {
  'wizard-ask': [
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
  'task-notice': [
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
};

/** The overlay a store with no screens raises: an open question, then an open notice. */
export function answerScreen(
  session: Pick<WizardSession, 'pendingQuestion' | 'taskNotice'>,
): 'wizard-ask' | 'task-notice' | null {
  if (session.pendingQuestion) return 'wizard-ask';
  if (session.taskNotice) return 'task-notice';
  return null;
}

const enumValues = <T extends string>(e: Record<string, T>): readonly T[] =>
  Object.values(e);

/** An optional string param: absent is null. */
const nullableString = (
  subject: string,
  p: Record<string, unknown>,
  key: string,
): string | null =>
  p[key] === undefined ? null : requireString(subject, p, key);

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

/** An outro payload: `kind` must be one of the outro kinds; other fields pass as given. */
export function outroDataParam(
  subject: string,
  p: Record<string, unknown>,
): OutroData {
  const data = requireRecord(subject, p, 'data');
  requireOneOf(subject, data, 'kind', Object.values(OutroKind));
  return data as unknown as OutroData;
}

/** One route per session store setter a full-control parent may call by name. */
export const SESSION_SETTERS: readonly SessionSetterDef[] = [
  // ── Consent ──────────────────────────────────────────────────────
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
  // ── Readiness ─────────────────────────────────────────────────────
  {
    name: 'setReadinessResult',
    description:
      'The pre-flight readiness result the run checks before it starts; absent clears it.',
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
  // ── Pending requests ─────────────────────────────────────────────
  {
    name: 'requestQuestion',
    description:
      'Open a wizard_ask request; resolvePendingQuestion or cancelPendingQuestion answers it.',
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
    description: 'Open a task notice; resolveTaskNotice answers it.',
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
    description: 'Resolve the task notice: keep runs the step, false skips it.',
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
    name: 'setOutroData',
    description: 'The outro payload.',
    params: { data: 'OutroData ({ kind, message?, body?, ... })' },
    apply: (store, p) => store.setOutroData(outroDataParam('setOutroData', p)),
  },
];

/** A session store as the control server drives it, for a host with no screens. */
export function sessionControlTarget(store: SessionStore): ControlTarget {
  return {
    version: () => store.getVersion(),
    subscribe: (listener) => store.subscribe(listener),
    readState: () => projectControlState(store, answerScreen(store.session)),
    actions: () => {
      const screen = answerScreen(store.session);
      return (screen ? ANSWER_ACTIONS[screen] : []).map((def) => ({
        ...def,
        apply: (params) => def.apply(store, params),
      }));
    },
    setters: () =>
      SESSION_SETTERS.map((def) => ({
        ...def,
        apply: (params) => def.apply(store, params),
      })),
    runInFlight: () => store.session.runPhase === RunPhase.Running,
    hasApiKey: () => Boolean(store.session.apiKey),
    installDir: () => store.session.installDir,
  };
}
