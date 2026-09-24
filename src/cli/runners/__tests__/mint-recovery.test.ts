import { vi, it, expect, afterEach } from 'vitest';
import { runWizard } from '../run-wizard';
import { runProgramAgent } from '../run-program-agent';
import { startTUI } from '@tui/start-tui';
import { WizardStore } from '@tui/store';
import { InkUI } from '@tui/ink-ui';
import { posthogIntegrationConfig } from '@programs/posthog-integration';
import { ScreenId } from '@tui/router';
import { HostResolution } from '@shared/host-resolution';
import { analytics } from '@utils/analytics';
import { clearCleanup, runCleanups } from '@utils/cleanup-registry';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { setUI } from '@cli/ui';

vi.mock('../run-program-agent', () => ({ runProgramAgent: vi.fn() }));
vi.mock('@tui/start-tui', () => ({ startTUI: vi.fn() }));
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
vi.mock('@programs/task-stream/index', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@programs/task-stream/index')>()),
  TaskStreamPush: class {
    attach = vi.fn();
    shutdown() {
      return Promise.resolve();
    }
  },
  PostHogDestination: class {},
}));

afterEach(() => {
  clearCleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it.each([
  ['TUI setup fails before the agent starts', false, 1, 'setup'],
  ['SIGTERM arrives before the completion screen exits', false, 130, 'signal'],
  ['the completion wait fails after the agent succeeds', false, 1, 'wait'],
  ['the completion screen exits after a successful run', true, 0, 'success'],
] as const)(
  'when %s, the run-installed skill is kept: %s',
  async (_case, kept, exitCode, ending) => {
    const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-skills-'));
    const skillDir = path.join(installDir, '.claude', 'skills', 'installed');
    const install = () => {
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, '.posthog-wizard'), '');
    };
    const store = new WizardStore();
    setUI(new InkUI(store));
    vi.spyOn(store, 'runReadyHooks').mockImplementation(() => {
      if (ending !== 'setup') return Promise.resolve();
      install();
      return Promise.reject(new Error('TUI setup failed'));
    });
    vi.spyOn(store, 'getGate').mockResolvedValue(undefined);
    let dismiss!: () => void;
    const completion = vi.spyOn(store, 'waitUntil').mockImplementation(() => {
      if (ending === 'wait') return Promise.reject(new Error('wait failed'));
      if (ending !== 'signal') return Promise.resolve();
      return new Promise<void>((resolve) => (dismiss = resolve));
    });
    vi.mocked(startTUI).mockReturnValue({
      store,
      unmount: vi.fn(),
      waitForSetup: () => Promise.resolve(),
    });
    vi.mocked(runProgramAgent).mockImplementation(() => {
      install();
      return Promise.resolve();
    });
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
    try {
      runWizard(posthogIntegrationConfig, { installDir, telemetry: false });
      if (ending === 'signal') {
        await vi.waitFor(() => expect(completion).toHaveBeenCalled());
        process.emit('SIGTERM');
      }
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(exitCode));
      if (ending === 'signal') dismiss();
      await new Promise<void>((resolve) => setImmediate(resolve));
      runCleanups();

      expect(exit).toHaveBeenCalledOnce();
      expect(fs.existsSync(skillDir)).toBe(kept);
    } finally {
      fs.rmSync(installDir, { recursive: true, force: true });
    }
  },
);

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
