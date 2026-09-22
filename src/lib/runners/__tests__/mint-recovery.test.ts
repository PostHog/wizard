import { vi, it, expect, afterEach } from 'vitest';
import { runWizard } from '../run-wizard';
import { runProgramAgent } from '../run-program-agent';
import { startTUI } from '@ui/tui/start-tui';
import { WizardStore } from '@ui/tui/store';
import { InkUI } from '@ui/tui/ink-ui';
import { setUI } from '@ui';
import { posthogIntegrationConfig } from '@programs/posthog-integration';
import { ScreenId } from '@ui/tui/router';
import { HostResolution } from '@shared/host-resolution';
import { analytics } from '@utils/analytics';
import { clearCleanup } from '@utils/wizard-abort';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../run-program-agent', () => ({ runProgramAgent: vi.fn() }));
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
vi.mock('@programs/task-stream/index', () => ({
  TaskStreamPush: class {
    attach = vi.fn();
    shutdown() {
      return Promise.resolve();
    }
  },
}));
vi.mock('@programs/task-stream/destinations/posthog', () => ({
  PostHogDestination: class {},
}));

afterEach(() => {
  clearCleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it('cleans only new marked skills if TUI setup fails before the agent starts', async () => {
  const installDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'wizard-tui-cleanup-'),
  );
  const skillsDir = path.join(installDir, '.claude', 'skills');
  const makeSkill = (id: string, marked: boolean) => {
    const dir = path.join(skillsDir, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '# skill');
    if (marked) fs.writeFileSync(path.join(dir, '.posthog-wizard'), '');
  };
  makeSkill('preexisting', true);
  const store = new WizardStore();
  setUI(new InkUI(store));
  vi.spyOn(store, 'runReadyHooks').mockImplementation(() => {
    makeSkill('installed-before-agent', true);
    makeSkill('user-owned-before-agent', false);
    return Promise.reject(new Error('TUI setup failed'));
  });
  vi.mocked(startTUI).mockReturnValue({
    store,
    unmount: vi.fn(),
    waitForSetup: () => Promise.resolve(),
  });
  const exit = vi
    .spyOn(process, 'exit')
    .mockImplementation(() => undefined as never);
  try {
    runWizard(posthogIntegrationConfig, { installDir, telemetry: false });
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(fs.readdirSync(skillsDir).sort()).toEqual([
      'preexisting',
      'user-owned-before-agent',
    ]);
    expect(runProgramAgent).not.toHaveBeenCalled();
  } finally {
    fs.rmSync(installDir, { recursive: true, force: true });
  }
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
