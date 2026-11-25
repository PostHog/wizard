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

function setup(errorCode?: ErrorCode, isLoggedIn = true) {
  const store = new WizardStore();
  if (isLoggedIn)
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

it('sends the log, saves the skill, then continues setup', async () => {
  const { app, store, choose } = setup();
  await choose(0);
  expect(wizardCapture).toHaveBeenCalledWith(
    'failure reported',
    expect.objectContaining({ message: 'agent failed', is_capacity: false }),
  );
  expect(app.lastFrame()).toContain('Log sent.');
  expect(app.lastFrame()).toContain('Step 2 of 2');
  await choose(2);
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
    await choose(1);
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

it('exits without sending the log, saving or launching', async () => {
  const { app, store, services, choose } = setup();
  await choose(1);
  expect(app.lastFrame()).not.toContain('Log sent.');
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
  [ErrorCodes.AgentOrchestratorTasksFailed, "PostHog isn't set up yet"],
  [ErrorCodes.GatewayMintRefused, 'The wizard is busy right now'],
])(
  'asks about the log under a %s headline of %s, no error text',
  async (errorCode, headline) => {
    const { app } = setup(errorCode);
    await delay();
    const screenText = app.lastFrame()?.replace(/\s+/g, ' ');
    expect(screenText).toContain(headline);
    expect(screenText).toContain('We got the error automatically.');
    expect(screenText).toContain('Send your log too?');
    expect(screenText).not.toContain('agent failed');
  },
);

it('routes a failed login here and offers only Exit after the log question', async () => {
  const { app, store, choose } = setup(ErrorCodes.AuthLoginFailed, false);
  expect(store.router.resolve(store)).toBe(ScreenId.MintFailure);
  await choose(1);
  const screenText = app.lastFrame()?.replace(/\s+/g, ' ');
  expect(screenText).toContain("You're not logged in yet");
  expect(screenText).not.toContain('Open in Claude Code');
  await choose(0);
  expect(store.mintHandoff).toBe('exit');
});
