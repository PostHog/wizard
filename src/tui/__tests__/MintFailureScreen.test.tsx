import { vi, it, expect, afterEach } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import { WizardStore } from '../store';
import {
  MintFailureScreen,
  type MintFailureServices,
} from '../screens/MintFailureScreen';
import { KeyboardHintsProvider } from '../hooks/useKeyboardHints';
import { OutroKind } from '@shared/outro';
import { ErrorCodes, type ErrorCode } from '@shared/errors';
import { HostResolution } from '@shared/host-resolution';
import { ScreenId } from '../router';

const wizardCapture = vi.hoisted(() => vi.fn());

vi.mock('ink', () => vi.importActual<typeof import('ink')>('ink-actual'));
vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture,
    capture: vi.fn(),
    setTag: vi.fn(),
  } as never,
  sessionProperties: vi.fn(() => ({})),
}));

const saved = {
  path: '/project/.posthog/wizard-spellbook-123/README.md',
  skillsIncluded: true,
};
const delay = () => new Promise((resolve) => setTimeout(resolve, 30));

function setup(errorCode?: ErrorCode) {
  const store = new WizardStore();
  store.setCredentials({
    accessToken: 'tok',
    projectApiKey: 'pk',
    host: HostResolution.fromApiHost('https://app.posthog.com'),
    projectId: 1,
  });
  store.setOutroData({
    kind: OutroKind.Error,
    message: 'agent failed',
    errorCode,
  });
  const services: MintFailureServices = {
    leaveSpellbook: vi.fn().mockResolvedValue(saved),
    openAgent: vi.fn().mockResolvedValue(undefined),
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('sends the report, saves the skill, then continues setup', async () => {
  const { app, store, choose } = setup();
  await choose(0);
  expect(wizardCapture).toHaveBeenCalledWith(
    'failure reported',
    expect.objectContaining({ message: 'agent failed', is_capacity: false }),
  );
  expect(app.lastFrame()).toContain('Report sent to the wizard team.');
  await choose(0);
  expect(app.lastFrame()).toContain(saved.path);
  expect(store.mintHandoff).toBeNull();
  await choose(0);
  expect(store.mintHandoff).toBe('continue');
  expect(store.router.resolve(store)).toBe(ScreenId.Mcp);
});

it.each(['save', 'open'] as const)(
  'recovers from a %s failure without losing the handoff',
  async (failure) => {
    const { app, services, choose, store } = setup();
    vi.mocked(
      failure === 'save' ? services.leaveSpellbook : services.openAgent,
    ).mockRejectedValueOnce(new Error('Unavailable'));
    await choose(1);
    await choose(2);
    expect(app.lastFrame()).toContain(
      failure === 'save' ? 'Could not save' : 'Unavailable',
    );
    expect(store.mintHandoff).toBeNull();
    if (failure === 'save') expect(services.openAgent).not.toHaveBeenCalled();
    await choose(0);
    expect(services.leaveSpellbook).toHaveBeenCalledTimes(
      failure === 'save' ? 2 : 1,
    );
    expect(services.openAgent).toHaveBeenLastCalledWith('codex', saved.path);
    expect(store.mintHandoff).toBe('continue');
  },
);

it('exits without saving or launching', async () => {
  const { store, services, choose } = setup();
  await choose(1);
  await choose(3);
  expect(store.mintHandoff).toBe('exit');
  expect(wizardCapture).not.toHaveBeenCalledWith(
    'failure reported',
    expect.anything(),
  );
  expect(services.leaveSpellbook).not.toHaveBeenCalled();
  expect(services.openAgent).not.toHaveBeenCalled();
});

it.each([
  [
    ErrorCodes.AgentOrchestratorTasksFailed,
    "The wizard couldn't finish setup",
    true,
  ],
  [ErrorCodes.GatewayMintRefused, "The Wizard's a little busy", false],
])('heads a %s failure with %s', async (errorCode, headline, showsMessage) => {
  const { app } = setup(errorCode);
  await delay();
  expect(app.lastFrame()).toContain(headline);
  expect(app.lastFrame()?.includes('agent failed')).toBe(showsMessage);
});
