import { vi, it, expect, afterEach } from 'vitest';
import { runWizard } from '../run-wizard';
import { runProgramAgent } from '@lib/programs/run-agent-legacy';
import { startTUI } from '@ui/tui/start-tui';
import { WizardStore } from '@ui/tui/store';
import { InkUI } from '@ui/tui/ink-ui';
import { setUI } from '@ui';
import { posthogIntegrationConfig } from '@lib/programs/posthog-integration';
import { ScreenId } from '@ui/tui/router';
import { HostResolution } from '@shared/host-resolution';
import { analytics } from '@utils/analytics';
import { RunPhase } from '@lib/wizard-session';

const streamShutdown = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@lib/programs/run-agent-legacy', () => ({ runProgramAgent: vi.fn() }));
vi.mock('@ui/tui/start-tui', () => ({ startTUI: vi.fn() }));
vi.mock('@shared/local-dev', async (original) => ({
  ...(await original<typeof import('@shared/local-dev')>()),
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
    finishRun = vi.fn().mockResolvedValue(undefined);
    shutdown = streamShutdown;
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
    vi.mocked(runProgramAgent).mockImplementation(() => {
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

it('routes Ink cancellation through one cancelled shutdown and preserves exit 130', async () => {
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
  vi.mocked(runProgramAgent).mockImplementation(() => {
    store.setRunPhase(RunPhase.Running);
    return new Promise(() => undefined);
  });
  const exit = vi
    .spyOn(process, 'exit')
    .mockImplementation(() => undefined as never);
  runWizard(posthogIntegrationConfig, {
    installDir: '/tmp/cancellation-test',
    telemetry: false,
  });
  await vi.waitFor(() => expect(runProgramAgent).toHaveBeenCalled());
  const interrupt = vi.mocked(startTUI).mock.calls[0][2];
  interrupt?.();
  interrupt?.();
  await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(130));
  expect(streamShutdown).toHaveBeenCalledExactlyOnceWith(2000, 'cancelled');
  expect(analytics.shutdown).toHaveBeenCalledWith('cancelled');
  expect(unmount).toHaveBeenCalledOnce();
});
