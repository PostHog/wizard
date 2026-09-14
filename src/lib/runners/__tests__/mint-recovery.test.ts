import { vi, it, expect, afterEach } from 'vitest';
import { runWizard } from '../run-wizard';
import { runAgent } from '@lib/agent/agent-runner';
import { startTUI } from '@ui/tui/start-tui';
import { WizardStore } from '@ui/tui/store';
import { InkUI } from '@ui/tui/ink-ui';
import { setUI } from '@ui';
import { posthogIntegrationConfig } from '@lib/programs/posthog-integration';
import { GatewayMintFailed } from '@lib/gateway-session';
import { RunPhase } from '@lib/wizard-session';
import { ScreenId } from '@ui/tui/router';
import { analytics } from '@utils/analytics';

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
  'keeps the TUI alive after a failed mint until the user chooses %s',
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
    vi.mocked(runAgent).mockRejectedValue(
      new GatewayMintFailed('mint unavailable'),
    );
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
    runWizard(posthogIntegrationConfig, {
      installDir: '/tmp/handoff-test',
      telemetry: false,
    });
    await vi.waitFor(() => expect(store.session.agentHandoff).toBe('pending'));
    expect(store.session.runPhase).toBe(RunPhase.Error);
    expect(store.currentScreen).toBe(ScreenId.MintFailure);
    expect(unmount).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    if (action === 'continue') {
      store.setSpellbook({
        path: '/tmp/handoff-test/.posthog/book/README.md',
        skillsIncluded: true,
      });
      store.setAgentHandoff('continue');
      expect(store.currentScreen).toBe(ScreenId.Mcp);
      store.setSkillsComplete(true);
    } else store.setAgentHandoff('exit');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(unmount).toHaveBeenCalledOnce();
    expect(runAgent).toHaveBeenCalledOnce();
    expect(analytics.shutdown).toHaveBeenCalledWith('error');
  },
);
