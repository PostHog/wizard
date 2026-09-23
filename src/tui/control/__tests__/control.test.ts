import { WizardStore } from '../../store';
import { buildSession } from '../../session';
import { Overlay } from '../../router';
import { ScreenId } from '../../screen-sequences';
import {
  actionsFor,
  NO_ACTION_SCREENS,
  NOT_SETTERS,
  SCREENS_WITH_ACTIONS,
  SETTER_NAMES,
  settersFor,
  wizardStoreControlTarget,
} from '../index';
import { OutroKind } from '@shared/outro';
import { RunPhase, TaskStatus } from '@shared/run-state';
import { BadParamError, MissingParamError } from '@shared/control/params';

vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn(), setTag: vi.fn(), capture: vi.fn() },
  sessionProperties: () => ({}),
}));
vi.mock('@shared/claude-settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/claude-settings')>()),
  backupAndFixClaudeSettings: vi.fn(() => true),
}));

function store(program = 'posthog-integration'): WizardStore {
  const s = new WizardStore(program);
  s.session = buildSession({ installDir: '/tmp/control-tui' });
  return s;
}

/** Public members a WizardStore instance answers to, getters and fields excluded. */
function publicMethods(): string[] {
  const proto = WizardStore.prototype as unknown as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto).filter((name) => {
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    return !name.startsWith('_') && typeof desc?.value === 'function';
  });
}

describe('full control covers the store', () => {
  it('routes every public store method or names why it cannot', () => {
    const routed = new Set(SETTER_NAMES);
    const excluded = new Set(Object.keys(NOT_SETTERS));
    const members = publicMethods();
    expect(members.filter((m) => !routed.has(m) && !excluded.has(m))).toEqual(
      [],
    );
    expect([...routed].filter((m) => excluded.has(m))).toEqual([]);
    expect(
      [...routed, ...excluded].filter((m) => !members.includes(m)),
    ).toEqual([]);
  });

  // Valid params for every routed setter; a new setter without a fixture fails here.
  const FIXTURES: Record<string, Record<string, unknown>> = {
    completeSetup: {},
    grantSharing: {},
    declineSharing: {},
    switchProgram: { programId: 'metrics' },
    setCredentials: {
      accessToken: 'pha_x',
      projectApiKey: 'phc_x',
      projectId: 1,
      apiHost: 'https://us.posthog.com',
    },
    setAccessToken: {
      accessToken: 'pha_y',
      projectApiKey: 'phc_x',
      projectId: 1,
      apiHost: 'https://us.posthog.com',
    },
    setApiUser: {
      user: {
        distinct_id: 'u',
        organization: { is_ai_data_processing_approved: true },
      },
    },
    setRoleAtOrganization: { role: 'engineering' },
    setLoginUrl: { url: 'http://localhost:8239/login' },
    setAuthorizeUrl: {},
    chooseProvisionAccount: { email: 'a@b.co', region: 'eu' },
    setFrameworkConfig: { integration: 'nextjs' },
    setDetectedFramework: { label: 'Next.js App Router' },
    setDetectionComplete: {},
    setPosthogSdkDetected: { detected: true },
    setUnsupportedVersion: {
      current: '12',
      minimum: '13',
      docsUrl: 'https://x',
    },
    setSkillId: { skillId: 'integration-nextjs' },
    addDiscoveredFeature: { feature: 'stripe' },
    setFrameworkContext: { key: 'router', value: 'app' },
    setIntegrate: { integrate: true },
    enableFeature: { feature: 'llm' },
    completeRunStep: { stepId: 'integrate-run' },
    confirmSelfDrivingHandoff: {},
    setGithubConnected: {},
    declineGithub: { data: { kind: OutroKind.Cancel, message: 'no GitHub' } },
    setReadinessResult: {
      result: { decision: 'yes', health: {}, reasons: [] },
    },
    showSettingsOverride: {
      conflicts: [
        { source: 'project', path: '/tmp/s.json', keys: ['apiKeyHelper'] },
      ],
    },
    showPortConflict: { command: 'node', pid: '1', port: 8239, user: 'me' },
    dismissOutage: {},
    resolvePortConflict: {},
    showManualAuthCode: {},
    submitManualAuthCode: { code: 'abc' },
    dismissManualAuthCode: {},
    backupAndFixSettingsOverride: {},
    showAuthError: {},
    showSessionTimeout: {},
    pushOverlay: { overlay: Overlay.TaskNotice },
    popOverlay: {},
    requestQuestion: {
      question: {
        id: 'q1',
        questions: [{ id: 'a', prompt: 'Which?', kind: 'text' }],
      },
    },
    showTaskNotice: { notice: { title: 'Optional', body: 'Run it?' } },
    resolvePendingQuestion: { answers: { a: 'yes' } },
    cancelPendingQuestion: {},
    resolveTaskNotice: {},
    setRunPhase: { phase: RunPhase.Running },
    syncTodos: {
      todos: [{ content: 'Install SDK', status: TaskStatus.InProgress }],
    },
    setTasks: {
      tasks: [{ label: 'Install SDK', status: TaskStatus.Completed }],
    },
    updateTask: { index: 0, done: true },
    pushStatus: { message: 'Working' },
    setCurrentStage: { stage: 'install' },
    setEventPlan: { events: [{ name: 'signed_up', description: 'A signup' }] },
    setHandoffText: { text: '# Handoff' },
    setDashboardUrl: { url: 'https://us.posthog.com/dashboard/1' },
    setNotebookUrl: { url: 'https://us.posthog.com/notebooks/1' },
    addTokenUsage: {
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      cacheCreation5m: 0,
      cacheCreation1h: 0,
    },
    setFinalTokenCostUsd: { costUsd: 0.12 },
    setOutroData: { data: { kind: OutroKind.Success, message: 'Done' } },
    setMcpComplete: { outcome: 'installed', installedClients: ['Cursor'] },
    setSkillsComplete: {},
    setMcpSuggestedPromptsDismissed: {},
    setSlackStepDismissed: {},
    setSlackConnected: {},
    setOutroDismissed: {},
    setMintHandoff: { action: 'continue' },
    setSpellbook: { path: '/tmp/spellbook', skillsIncluded: true },
    setStatusExpanded: { expanded: true },
    toggleStatusExpanded: {},
    toggleTokenHud: {},
    setLearnCardBlockIdx: { idx: 1 },
    setLearnCardComplete: {},
  };

  it('has a fixture for every setter', () => {
    expect(SETTER_NAMES.filter((n) => !(n in FIXTURES))).toEqual([]);
  });

  it.each(SETTER_NAMES.map((n) => [n]))(
    '%s applies with valid params and commits',
    (name) => {
      const s = store();
      const before = s.getVersion();
      const setter = settersFor(s).find((x) => x.name === name);
      expect(() => setter?.apply(FIXTURES[name])).not.toThrow();
      expect(s.getVersion()).toBeGreaterThanOrEqual(before);
    },
  );

  it('writes the progress a run would report, without running one', () => {
    const s = store();
    const call = (name: string, params: Record<string, unknown>) =>
      settersFor(s)
        .find((x) => x.name === name)
        ?.apply(params);
    call('setRunPhase', { phase: RunPhase.Completed });
    call('syncTodos', {
      todos: [{ content: 'Verify', status: TaskStatus.Completed }],
    });
    expect(s.session.runPhase).toBe(RunPhase.Completed);
    expect(s.tasks.map((t) => t.label)).toEqual(['Verify']);
  });

  it('rejects a missing or malformed param by name', () => {
    const s = store();
    const setRunPhase = settersFor(s).find((x) => x.name === 'setRunPhase');
    expect(() => setRunPhase?.apply({})).toThrow(MissingParamError);
    expect(() => setRunPhase?.apply({ phase: 'done-ish' })).toThrow(
      BadParamError,
    );
  });
});

describe('partial control follows the screens', () => {
  it('names every screen and overlay: some action, an intro, or none on purpose', () => {
    const withActions = new Set(SCREENS_WITH_ACTIONS);
    const all = [
      ...Object.values(ScreenId),
      ...Object.values(Overlay),
    ] as string[];
    const unclassified = all.filter(
      (s) =>
        !withActions.has(s) &&
        !NO_ACTION_SCREENS.has(s) &&
        !(s === ScreenId.Intro || s.endsWith('-intro')),
    );
    expect(unclassified).toEqual([]);
  });

  it('answers a question only while one is pending', async () => {
    const s = store();
    const target = wizardStoreControlTarget(s, { screens: false });
    expect(target.actions()).toEqual([]);

    const answered = s.requestQuestion({
      id: 'q1',
      source: 'test',
      questions: [{ id: 'db', prompt: 'Which DB?', kind: 'text' }],
    });
    expect(target.readState().currentScreen).toBe('wizard-ask');
    target
      .actions()
      .find((a) => a.id === 'answer_question')
      ?.apply({ answers: { db: 'pg' } });
    await expect(answered).resolves.toEqual({ db: 'pg' });
    expect(target.actions()).toEqual([]);
  });

  it('chooses only a declared setup key and one of its options', () => {
    const s = store();
    settersFor(s)
      .find((x) => x.name === 'setFrameworkConfig')
      ?.apply({ integration: 'nextjs' });
    const [question] =
      s.session.frameworkConfig?.metadata.setup?.questions ?? [];
    const choose = actionsFor(s, ScreenId.Setup).find((a) => a.id === 'choose');
    expect(() => choose?.apply({ key: 'nope', value: 'x' })).toThrow(
      BadParamError,
    );
    expect(() =>
      choose?.apply({ key: question.key, value: 'not-an-option' }),
    ).toThrow(BadParamError);
    choose?.apply({ key: question.key, value: question.options[0].value });
    expect(s.session.frameworkContext[question.key]).toBe(
      question.options[0].value,
    );
  });

  it('picks an integration target only for a known framework', () => {
    const s = store('self-driving');
    const pick = actionsFor(s, ScreenId.SelfDrivingIntegrationDetect).find(
      (a) => a.id === 'pick_integration_target',
    );
    expect(() =>
      pick?.apply({ path: 'apps/web', integration: 'cobol' }),
    ).toThrow(BadParamError);
    pick?.apply({ path: 'apps/web', integration: 'nextjs' });
    expect(s.session.integration).toBe('nextjs');
  });

  it('ends the self-driving run before the agent when GitHub is declined', () => {
    const s = store('self-driving');
    actionsFor(s, ScreenId.SelfDrivingGithub)
      .find((a) => a.id === 'decline_github')
      ?.apply({});
    expect(s.session.githubDeclined).toBe(true);
    expect(s.session.outroData?.kind).toBe(OutroKind.Cancel);
  });
});
