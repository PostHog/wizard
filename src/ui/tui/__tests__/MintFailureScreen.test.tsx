import { vi, it, expect, afterEach } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import { WizardStore } from '../store';
import {
  MintFailureScreen,
  type MintFailureServices,
} from '../screens/MintFailureScreen';
import { KeyboardHintsProvider } from '../hooks/useKeyboardHints';
import { OutroKind } from '@lib/wizard-session';
import { ErrorCodes } from '@lib/errors/codes';
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
  store.setAgentHandoff('pending');
  store.setOutroData({
    kind: OutroKind.Error,
    errorCode: ErrorCodes.GatewayMintFailed,
  });
  const services: MintFailureServices = {
    leaveSpellbook: vi.fn().mockResolvedValue(saved),
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

it('reports the log, saves skills, then continues setup', async () => {
  const { app, store, services, choose } = setup();
  await choose(1);
  expect(app.lastFrame()).toContain(services.logPath);
  await choose(0);
  expect(store.session.spellbook).toEqual(saved);
  expect(store.session.agentHandoff).toBe('continue');
  expect(store.router.resolve(store.session)).toBe(ScreenId.Mcp);
});

it('recovers from a save failure without losing the handoff', async () => {
  const { app, services, choose, store } = setup();
  vi.mocked(services.leaveSpellbook).mockRejectedValueOnce(
    new Error('not writable'),
  );
  await choose(0);
  expect(app.lastFrame()).toContain('Could not save');
  expect(store.session.agentHandoff).toBe('pending');
  await choose(0);
  expect(services.leaveSpellbook).toHaveBeenCalledTimes(2);
  expect(store.session.agentHandoff).toBe('continue');
});

it('exits without saving', async () => {
  const { store, services, choose } = setup();
  await choose(2);
  expect(store.session.agentHandoff).toBe('exit');
  expect(services.leaveSpellbook).not.toHaveBeenCalled();
});
