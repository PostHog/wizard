import { vi, it, expect, afterEach } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import { WizardStore } from '../store';
import {
  MintFailureScreen,
  type MintFailureServices,
} from '../screens/MintFailureScreen';
import { KeyboardHintsProvider } from '../hooks/useKeyboardHints';
import { OutroKind } from '@lib/wizard-session';
import { HostResolution } from '@shared/host-resolution';
import { ScreenId } from '../router';

vi.mock('ink', () =>
  vi.importActual('../../../../node_modules/ink/build/index.js'),
);
vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn(), capture: vi.fn(), setTag: vi.fn() },
  sessionProperties: vi.fn(() => ({})),
}));

const saved = {
  path: '/project/.posthog/wizard-spellbook-123/README.md',
  skillsIncluded: true,
};
const delay = () => new Promise((resolve) => setTimeout(resolve, 30));

function setup() {
  const store = new WizardStore();
  store.setCredentials({
    accessToken: 'tok',
    projectApiKey: 'pk',
    host: HostResolution.fromApiHost('https://app.posthog.com'),
    projectId: 1,
  });
  store.setOutroData({ kind: OutroKind.Error, message: 'agent failed' });
  const services: MintFailureServices = {
    leaveSpellbook: vi.fn().mockResolvedValue(saved),
    openAgent: vi.fn().mockResolvedValue(undefined),
    logPath: '/tmp/posthog-wizard.log',
  };
  const app = render(
    <KeyboardHintsProvider>
      <MintFailureScreen store={store} services={services} />
    </KeyboardHintsProvider>,
  );
  const choose = async (index: number) => {
    await delay();
    for (let i = 0; i < index; i++) {
      app.stdin.write('[B');
      await delay();
    }
    app.stdin.write('\r');
    await delay();
  };
  return { store, services, app, choose };
}

afterEach(cleanup);

it('reports the log, saves the skill, then continues setup', async () => {
  const { app, store, services, choose } = setup();
  await choose(3);
  expect(app.lastFrame()).toContain(services.logPath);
  await choose(0);
  expect(app.lastFrame()).toContain(saved.path);
  expect(store.session.mintHandoff).toBeNull();
  await choose(0);
  expect(store.session.mintHandoff).toBe('continue');
  expect(store.router.resolve(store.session)).toBe(ScreenId.Mcp);
});

it.each(['save', 'open'] as const)(
  'recovers from a %s failure without losing the handoff',
  async (failure) => {
    const { app, services, choose, store } = setup();
    vi.mocked(
      failure === 'save' ? services.leaveSpellbook : services.openAgent,
    ).mockRejectedValueOnce(new Error('Unavailable'));
    await choose(2);
    expect(app.lastFrame()).toContain(
      failure === 'save' ? 'Could not save' : 'Unavailable',
    );
    expect(store.session.mintHandoff).toBeNull();
    if (failure === 'save') expect(services.openAgent).not.toHaveBeenCalled();
    await choose(0);
    expect(services.leaveSpellbook).toHaveBeenCalledTimes(
      failure === 'save' ? 2 : 1,
    );
    expect(services.openAgent).toHaveBeenLastCalledWith('codex', saved.path);
    expect(store.session.mintHandoff).toBe('continue');
  },
);

it('exits without saving or launching', async () => {
  const { store, services, choose } = setup();
  await choose(4);
  expect(store.session.mintHandoff).toBe('exit');
  expect(services.leaveSpellbook).not.toHaveBeenCalled();
  expect(services.openAgent).not.toHaveBeenCalled();
});
