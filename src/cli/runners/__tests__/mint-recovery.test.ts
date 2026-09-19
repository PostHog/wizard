import { vi, it, expect, afterEach } from 'vitest';
import { runWizard } from '../run-wizard.js';
import { runAgent } from '@agent';
import { startTUI } from '@tui';
import { WizardStore } from '@store/state/store';
import { StoreUI } from '@store/ui/store-ui';
import { setUI } from '@store/ui';
import { posthogIntegrationConfig } from '@store/programs/posthog-integration';
import { ScreenId } from '@tui/router';
import { HostResolution } from '@store/host-resolution';
import { analytics } from '@store/shared/analytics';
import { flowFor } from '@store/programs/flow-for';
import { Program } from '@store/programs/program-registry';

vi.mock('@agent', () => ({ runAgent: vi.fn() }));
vi.mock('@tui', () => ({ startTUI: vi.fn() }));
vi.mock('@store/local-dev', async (original) => ({
  ...(await original<typeof import('@store/local-dev')>()),
  getLocalDev: () => ({}),
  checkLocalServices: () => Promise.resolve(null),
}));
vi.mock('@store/shared/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
    setTag: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
  sessionProperties: () => ({}),
}));
vi.mock('@store/task-stream/task-stream-push', () => ({
  TaskStreamPush: class {
    attach = vi.fn();
    shutdown() {
      return Promise.resolve();
    }
  },
}));
vi.mock('@store/task-stream/destinations/posthog', () => ({
  PostHogDestination: class {},
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it.each(['continue', 'exit'] as const)(
  'catches a failed run, shows the handoff screen, and exits 1 after %s',
  async (action) => {
    const store = new WizardStore(flowFor(Program.PostHogIntegration).flow);
    setUI(new StoreUI(store));
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
