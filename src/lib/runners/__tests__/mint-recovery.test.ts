import { vi, it, expect, afterEach } from 'vitest';
import { runWizard } from '../run-wizard';
import { runAgent } from '@lib/agent/agent-runner';
import { startTUI } from '@ui/tui/start-tui';
import { WizardStore } from '@ui/tui/store';
import { InkUI } from '@ui/tui/ink-ui';
import { setUI } from '@ui';
import { posthogIntegrationConfig } from '@lib/programs/posthog-integration';
import { ScreenId } from '@ui/tui/router';
import { HostResolution } from '@lib/host-resolution';
import { authenticate } from '@lib/agent/runner/shared/authenticate';
import { GatewayMintRefused } from '@lib/gateway-session';
import { ProvisionedAccountHandoff } from '@lib/provisioned-account-handoff';
import { analytics } from '@utils/analytics';

vi.mock('@lib/agent/runner/shared/authenticate', () => ({
  authenticate: vi.fn(),
}));
vi.mock('@lib/agent/agent-runner', () => ({ runAgent: vi.fn() }));
vi.mock('@ui/tui/start-tui', () => ({ startTUI: vi.fn() }));
vi.mock('@lib/local-dev', async (original) => ({
  ...(await original<typeof import('@lib/local-dev')>()),
  getLocalDev: () => ({}),
  checkLocalServices: () => Promise.resolve(null),
}));
vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
    setTag: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
  sessionProperties: () => ({}),
}));
vi.mock('@lib/task-stream/index', () => ({
  TaskStreamPush: class {
    attach = vi.fn();
    shutdown() {
      return Promise.resolve();
    }
  },
}));
vi.mock('@lib/task-stream/destinations/posthog', () => ({
  PostHogDestination: class {},
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it.each(['continue', 'exit'] as const)(
  'catches a failed run, shows the handoff screen, and exits 1 after %s',
  async (action) => {
    const store = new WizardStore();
    setUI(new InkUI(store));
    vi.spyOn(store, 'runReadyHooks').mockResolvedValue(undefined);
    vi.spyOn(store, 'getGate').mockResolvedValue(undefined);
    const unmount = vi.fn();
    vi.mocked(startTUI).mockReturnValue({
      store,
      unmount,
      waitForSetup: () => Promise.resolve(),
    });
    // runWizard installs its own session first; auth then sets credentials,
    // and the agent dies after that.
    vi.mocked(runAgent).mockImplementation(() => {
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: HostResolution.fromApiHost('https://app.posthog.com'),
        projectId: 1,
      });
      return Promise.reject(new Error('agent exploded'));
    });
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);

    runWizard(posthogIntegrationConfig, {
      installDir: '/tmp/handoff-test',
      telemetry: false,
    });

    await vi.waitFor(() =>
      expect(store.currentScreen).toBe(ScreenId.MintFailure),
    );
    expect(unmount).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    if (action === 'continue') {
      store.setMintHandoff('continue');
      expect(store.currentScreen).toBe(ScreenId.Mcp);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(exit).not.toHaveBeenCalled();
      store.setSkillsComplete(true);
    } else {
      store.setMintHandoff('exit');
    }
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(unmount).toHaveBeenCalledOnce();
    expect(analytics.shutdown).toHaveBeenCalledWith('error');
  },
);

it.each(['new signup', 'existing provisioned account', 'composed signup'])(
  'finishes %s with an intentional handoff and a successful exit',
  async (scenario) => {
    const store = new WizardStore();
    setUI(new InkUI(store));
    vi.spyOn(store, 'runReadyHooks').mockResolvedValue(undefined);
    vi.spyOn(store, 'getGate').mockResolvedValue(undefined);
    const unmount = vi.fn();
    vi.mocked(startTUI).mockReturnValue({
      store,
      unmount,
      waitForSetup: () => Promise.resolve(),
    });
    const handoff = () => {
      store.setCredentials({
        accessToken: 'pha_private',
        projectApiKey: 'phc_capture',
        host: HostResolution.fromApiHost('https://us.i.posthog.com'),
        projectId: 42,
      });
      return Promise.reject(
        scenario === 'existing provisioned account'
          ? new GatewayMintRefused(
              403,
              'Use your own agent.',
              'provisioned_account_gateway_disabled',
            )
          : new ProvisionedAccountHandoff(),
      );
    };
    vi.mocked(runAgent).mockImplementation(handoff);
    vi.mocked(authenticate).mockImplementation(handoff);
    const nextRun = vi.fn();
    const config =
      scenario === 'composed signup'
        ? {
            ...posthogIntegrationConfig,
            steps: [
              { id: 'auth', label: 'Auth', screenId: 'auth' },
              { id: 'run', label: 'Run', screenId: 'run', run: nextRun },
            ],
          }
        : posthogIntegrationConfig;
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
    runWizard(config, { installDir: '/tmp/handoff-test', telemetry: false });
    await vi.waitFor(() =>
      expect(store.currentScreen).toBe(ScreenId.MintFailure),
    );
    expect(store.session.outroData?.handoffReason).toBe('provisioned_account');
    store.setMintHandoff('continue');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(nextRun).not.toHaveBeenCalled();
    expect(analytics.captureException).not.toHaveBeenCalled();
    expect(analytics.shutdown).toHaveBeenCalledWith('success');
  },
);
