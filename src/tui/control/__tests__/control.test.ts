import { WizardStore } from '../../store';
import { buildSession } from '@programs';
import { Overlay } from '../../router';
import { ScreenId } from '../../screen-sequences';
import {
  actionsFor,
  noActionScreens,
  NOT_SETTERS,
  programSetterNames,
  screensWithActions,
  SETTER_NAMES,
  settersFor,
  wizardStoreControlTarget,
} from '../index';
import { programScreenIds } from '../../programs/index';
import { toolScreenIds } from '../../tools/index';
import { OutroKind } from '@shared/outro';
import { RunPhase } from '@shared/run-state';
import { TaskStatus } from '@shared/task-status';
import { BadParamError, MissingParamError } from '@shared/control/params';
import { SelfDrivingScreenId } from '@tui/programs/self-driving';
import { McpOutcome } from '@shared/run-state';
import { applySetter } from '@tui/__tests__/helpers/apply-setter.no-jest';

vi.mock(import('@utils/analytics'), () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    capture: vi.fn(),
  } as never,
  sessionProperties: () => ({}),
}));
vi.mock(import('@shared/claude-settings'), async (importOriginal) => ({
  ...(await importOriginal()),
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

describe('the TUI target', () => {
  it("serves the router's screen and commits its action through the store", () => {
    const s = store();
    const target = wizardStoreControlTarget(s);
    expect(target.readState().currentScreen).toBe('intro');
    expect(target.actions().map((a) => a.id)).toEqual(['confirm_setup']);
    target.actions()[0].apply({ share: false });
    expect(s.setupConfirmed).toBe(true);
    expect(target.readState().currentScreen).not.toBe('intro');
  });
});

// GET /state as a parent reads it: key order and values, byte for byte.
const PROJECTED_STATE = `{
  "version": 15,
  "currentScreen": "health-check",
  "session": {
    "installDir": "/tmp/control-tui",
    "integration": null,
    "detectedFrameworkLabel": null,
    "detectionComplete": false,
    "frameworkContext": {
      "uploadApiKey": "[redacted]"
    },
    "discoveredFeatures": [],
    "runPhase": "idle",
    "pendingQuestion": null,
    "taskNotice": null,
    "outroData": {
      "kind": "success",
      "message": "Done"
    },
    "dashboardUrl": "https://us.posthog.com/dashboard/1",
    "notebookUrl": null,
    "setupConfirmed": true,
    "integrate": true,
    "completedRuns": [
      "integrate-run"
    ],
    "outroDismissed": true,
    "mcpComplete": true,
    "slackStepDismissed": true,
    "skillsComplete": true,
    "hasCredentials": false,
    "projectId": null
  },
  "tasks": [],
  "statusMessages": [],
  "eventPlan": [],
  "handoffText": null,
  "setupQuestions": []
}`;

describe('GET /state', () => {
  it('projects the session and the screen answers a parent reads, and nothing else', () => {
    const s = store();
    s.completeSetup();
    applySetter(s, 'setIntegrate', { integrate: true });
    s.completeRunStep('integrate-run');
    s.setOutroData({ kind: OutroKind.Success, message: 'Done' });
    s.setOutroDismissed();
    s.setMcpComplete(McpOutcome.Installed, ['Cursor'], 'all', ['login']);
    s.setSlackStepDismissed();
    s.setSkillsComplete(true);
    s.setFrameworkContext('uploadApiKey', 'hunter2');
    s.setDashboardUrl('https://us.posthog.com/dashboard/1');
    // Display state stays in the process.
    s.setLoginUrl('http://localhost:8239/login');
    s.setAuthorizeUrl('https://us.posthog.com/authorize');
    s.setSlackConnected(true);
    s.setSpellbook({ path: '/tmp/spellbook', skillsIncluded: true });
    const state = wizardStoreControlTarget(s).readState();
    expect(JSON.stringify(state, null, 2)).toBe(PROJECTED_STATE);
  });
});

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

  // Valid params for every routed setter; a new setter that takes params fails below without one.
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

  const ALL_SETTER_NAMES = [...SETTER_NAMES, ...programSetterNames()];

  it.each(ALL_SETTER_NAMES.map((n) => [n]))(
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
    const withActions = new Set(screensWithActions());
    const noActions = noActionScreens();
    const all = [
      ...Object.values(ScreenId),
      ...programScreenIds(),
      ...toolScreenIds(),
      ...Object.values(Overlay),
    ] as string[];
    const unclassified = all.filter(
      (s) => !withActions.has(s) && !noActions.has(s) && !s.endsWith('-intro'),
    );
    expect(unclassified).toEqual([]);
  });

  it('answers a question on its overlay only while one is pending', async () => {
    const s = store();
    const target = wizardStoreControlTarget(s);
    const answer = () =>
      target.actions().find((a) => a.id === 'answer_question');
    expect(answer()).toBeUndefined();

    const answered = s.requestQuestion({
      id: 'q1',
      source: 'test',
      questions: [{ id: 'db', prompt: 'Which DB?', kind: 'text' }],
    });
    expect(target.readState().currentScreen).toBe('wizard-ask');
    answer()?.apply({ answers: { db: 'pg' } });
    await expect(answered).resolves.toEqual({ db: 'pg' });
    expect(answer()).toBeUndefined();
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
    const pick = actionsFor(s, SelfDrivingScreenId.IntegrationDetect).find(
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
    actionsFor(s, SelfDrivingScreenId.Github)
      .find((a) => a.id === 'decline_github')
      ?.apply({});
    expect(s.githubDeclined).toBe(true);
    expect(s.session.outroData?.kind).toBe(OutroKind.Cancel);
  });

  it('resolves a task notice on its overlay: keep, skip, or keep by default', async () => {
    const notice = {
      title: 'Connect',
      body: [],
      items: ['Postgres'],
      confirmLabel: 'Continue',
      cancelLabel: 'Skip',
      prompt: 'Now?',
    };
    const resolve = (params: Record<string, unknown>) => {
      const s = store();
      const kept = s.showTaskNotice(notice);
      wizardStoreControlTarget(s)
        .actions()
        .find((a) => a.id === 'resolve_notice')
        ?.apply(params);
      return kept;
    };
    await expect(resolve({ keep: true })).resolves.toBe(true);
    await expect(resolve({ keep: false })).resolves.toBe(false);
    await expect(resolve({})).resolves.toBe(true);
  });

  it('records the MCP outcome set_mcp_outcome names', () => {
    const s = store();
    actionsFor(s, ScreenId.Mcp)
      .find((a) => a.id === 'set_mcp_outcome')
      ?.apply({ outcome: 'skipped' });
    expect(s.mcpOutcome).toBe(McpOutcome.Skipped);
  });
});
