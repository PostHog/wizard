import { Program } from '../../programs/program-registry.js';
import {
  AdditionalFeature,
  DiscoveredFeature,
  McpOutcome,
  ScanConsent,
} from '../../session/wizard-session.js';
import { STORE_BOUNDARY_MEMBERS } from '../../state/store-api.js';
import { FlowStore } from '../../state/store.js';
import { createControlledStore, expectNoSecrets } from '../../testing/index.js';
import { actionsFor } from '../actions.js';
import { ControlDriver } from '../driver.js';
import { BadParamError, MissingParamError } from '../params.js';
import {
  CONTROL_SETTERS,
  setterNamed,
  UnknownSetterError,
} from '../setters.js';

function storeFor(): FlowStore {
  return createControlledStore(Program.PostHogIntegration, {
    installDir: '/tmp/control-setters',
  });
}

function apply(store: FlowStore, name: string, params = {}) {
  const setter = setterNamed(name);
  if (!setter) throw new Error(`no setter ${name}`);
  setter.apply(store, params);
}

describe('the setter table', () => {
  it('names only FlowStore methods inside the boundary, each once', () => {
    const names = CONTROL_SETTERS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(STORE_BOUNDARY_MEMBERS).toContain(name);
      expect(
        typeof (FlowStore.prototype as unknown as Record<string, unknown>)[
          name
        ],
      ).toBe('function');
    }
  });

  it('is screen independent: a setter applies where no action offers it', () => {
    const store = storeFor();
    expect(store.currentScreen).toBe('intro');
    expect(
      actionsFor(store.flow, store.currentScreen).map((a) => a.id),
    ).not.toContain('setFrameworkContext');
    const state = new ControlDriver(store).applySetter('setFrameworkContext', {
      key: 'router',
      value: 'app',
    });
    expect(state.session.frameworkContext).toEqual({ router: 'app' });
    expect(store.session.frameworkContext.router).toBe('app');
  });

  it('rejects a name outside the table', () => {
    const driver = new ControlDriver(storeFor());
    expect(() => driver.applySetter('setTasks', {})).toThrow(
      UnknownSetterError,
    );
    expect(() => driver.applySetter('nope', {})).toThrow(UnknownSetterError);
  });
});

/** Each setter: the params that apply, what they change, and one wrong shape that is refused. */
const CASES: Array<{
  name: string;
  params?: Record<string, unknown>;
  expect: (store: FlowStore) => void;
  bad?: Record<string, unknown>;
  badError?: typeof BadParamError | typeof MissingParamError;
}> = [
  {
    name: 'completeSetup',
    expect: (s) => expect(s.session.setupConfirmed).toBe(true),
  },
  {
    name: 'grantSharing',
    expect: (s) => expect(s.session.scanConsent).toBe(ScanConsent.Granted),
  },
  {
    name: 'declineSharing',
    expect: (s) => expect(s.session.scanConsent).toBe(ScanConsent.Declined),
  },
  {
    name: 'setCredentials',
    params: {
      accessToken: 'phx_SECRET',
      projectApiKey: 'phc_TOKEN',
      projectId: 7,
      apiHost: 'https://eu.posthog.com',
    },
    expect: (s) => {
      expect(s.session.credentials).toMatchObject({ projectId: 7 });
      expect(s.session.credentials?.host.region).toBe('eu');
    },
    bad: {
      accessToken: 'phx_SECRET',
      projectApiKey: 'phc_TOKEN',
      projectId: '7',
      apiHost: 'https://eu.posthog.com',
    },
    badError: BadParamError,
  },
  {
    name: 'setRoleAtOrganization',
    params: { role: 'engineer' },
    expect: (s) => expect(s.session.roleAtOrganization).toBe('engineer'),
    bad: { role: 3 },
    badError: MissingParamError,
  },
  {
    name: 'setFrameworkConfig',
    params: { integration: 'nextjs' },
    expect: (s) => {
      expect(s.session.integration).toBe('nextjs');
      expect(s.session.frameworkConfig).toBeTruthy();
    },
    bad: { integration: 'cobol' },
    badError: BadParamError,
  },
  {
    name: 'setDetectedFramework',
    params: { label: 'Next.js' },
    expect: (s) => expect(s.session.detectedFrameworkLabel).toBe('Next.js'),
    bad: {},
    badError: MissingParamError,
  },
  {
    name: 'setDetectionComplete',
    expect: (s) => expect(s.session.detectionComplete).toBe(true),
  },
  {
    name: 'setFrameworkContext',
    params: { key: 'depth', value: { nested: [1, 2] } },
    expect: (s) =>
      expect(s.session.frameworkContext.depth).toEqual({ nested: [1, 2] }),
    bad: { key: 'depth' },
    badError: MissingParamError,
  },
  {
    name: 'setIntegrate',
    params: { integrate: false },
    expect: (s) => expect(s.session.integrate).toBe(false),
    bad: { integrate: 'no' },
    badError: BadParamError,
  },
  {
    name: 'enableFeature',
    params: { feature: AdditionalFeature.LLM },
    expect: (s) => {
      expect(s.session.additionalFeatureQueue).toContain(AdditionalFeature.LLM);
      expect(s.session.llmOptIn).toBe(true);
    },
    bad: { feature: 'telepathy' },
    badError: BadParamError,
  },
  {
    name: 'addDiscoveredFeature',
    params: { feature: DiscoveredFeature.Stripe },
    expect: (s) =>
      expect(s.session.discoveredFeatures).toContain(DiscoveredFeature.Stripe),
    bad: { feature: 'telepathy' },
    badError: BadParamError,
  },
  {
    name: 'switchProgram',
    params: { programId: Program.Audit },
    expect: (s) => expect(s.activeProgram).toBe(Program.Audit),
    bad: { programId: 'not-a-program' },
    badError: BadParamError,
  },
  {
    name: 'setMcpComplete',
    params: { outcome: McpOutcome.Installed, installedClients: ['cursor'] },
    expect: (s) => {
      expect(s.session.mcpComplete).toBe(true);
      expect(s.session.mcpOutcome).toBe(McpOutcome.Installed);
      expect(s.session.mcpInstalledClients).toEqual(['cursor']);
    },
    bad: { outcome: 'maybe' },
    badError: BadParamError,
  },
  {
    name: 'setSkillsComplete',
    params: { kept: false },
    expect: (s) => expect(s.session.skillsComplete).toBe(true),
    bad: { kept: 'false' },
    badError: BadParamError,
  },
  {
    name: 'setMcpSuggestedPromptsDismissed',
    expect: (s) => expect(s.session.mcpSuggestedPromptsDismissed).toBe(true),
  },
  {
    name: 'setSlackStepDismissed',
    expect: (s) => expect(s.session.slackStepDismissed).toBe(true),
  },
  {
    name: 'setSlackConnected',
    expect: (s) => expect(s.session.slackConnected).toBe(true),
    bad: { connected: 1 },
    badError: BadParamError,
  },
  {
    name: 'setGithubConnected',
    params: { connected: false },
    expect: (s) => expect(s.session.githubConnected).toBe(false),
  },
  {
    name: 'confirmSelfDrivingHandoff',
    expect: (s) => expect(s.session.selfDrivingHandoffConfirmed).toBe(true),
  },
  {
    name: 'setOutroDismissed',
    expect: (s) => expect(s.session.outroDismissed).toBe(true),
  },
  {
    name: 'setMintHandoff',
    params: { action: 'exit' },
    expect: (s) => expect(s.session.mintHandoff).toBe('exit'),
    bad: { action: 'retry' },
    badError: BadParamError,
  },
  {
    name: 'dismissOutage',
    expect: () => undefined,
  },
];

describe.each(CASES)('$name', (c) => {
  it('applies through the store and emits', () => {
    const store = storeFor();
    const before = store.getVersion();
    apply(store, c.name, c.params);
    c.expect(store);
    expect(store.getVersion()).toBeGreaterThan(before);
  });

  if (c.bad) {
    it('refuses a wrong shape without touching the store', () => {
      const store = storeFor();
      const snapshot = JSON.stringify(store.session);
      expect(() => apply(store, c.name, c.bad)).toThrow(c.badError);
      expect(JSON.stringify(store.session)).toBe(snapshot);
    });
  }
});

describe('setters that resolve a pending interrupt', () => {
  it('answers the pending question and pops the interrupt', async () => {
    const store = storeFor();
    const answer = store.requestQuestion({
      id: 'q1',
      source: 'control',
      questions: [{ id: 'a', prompt: 'A?', kind: 'text' }],
    } as never);
    expect(store.hasInterrupt).toBe(true);
    apply(store, 'resolvePendingQuestion', { answers: { a: 'yes' } });
    await expect(answer).resolves.toEqual({ a: 'yes' });
    expect(store.hasInterrupt).toBe(false);
  });

  it('refuses an answers map with a non-string value', () => {
    const store = storeFor();
    expect(() =>
      apply(store, 'resolvePendingQuestion', { answers: { a: 1 } }),
    ).toThrow(BadParamError);
  });

  it('resolves the task notice with the keep decision', async () => {
    const store = storeFor();
    const decision = store.showTaskNotice({
      title: 't',
      body: [],
      confirmLabel: 'y',
      cancelLabel: 'n',
      prompt: 'p',
    });
    apply(store, 'resolveTaskNotice', { keep: false });
    await expect(decision).resolves.toBe(false);
  });
});

describe('what the wire sees after setCredentials', () => {
  it('projects the flag and the project id, never the token or key', () => {
    const store = storeFor();
    const state = new ControlDriver(store).applySetter('setCredentials', {
      accessToken: 'phx_SECRET_VALUE',
      projectApiKey: 'phc_TOKEN_VALUE',
      projectId: 7,
      apiHost: 'https://us.posthog.com',
    });
    expect(state.session.hasCredentials).toBe(true);
    expect(state.session.projectId).toBe(7);
    expectNoSecrets(JSON.stringify(state), [
      'phx_SECRET_VALUE',
      'phc_TOKEN_VALUE',
    ]);
  });
});
