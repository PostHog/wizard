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
import { Program, type ProgramId } from '@programs';
import { HostResolution } from '@shared/host-resolution';
import { ScreenId } from '../router';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { configureLogFile, logToFile } from '@utils/debug';
import { failureReportProperties } from '../mint-failure';

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

function setup(
  errorCode?: ErrorCode,
  isLoggedIn = true,
  program: ProgramId = Program.PostHogIntegration,
) {
  const store = new WizardStore(program);
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

it('skips the log question when the carbon unit declined access, offering only Exit', async () => {
  const { app } = setup(ErrorCodes.AuthAccessDenied, false);
  await delay();
  const screenText = app.lastFrame()?.replace(/\s+/g, ' ');
  expect(screenText).toContain("You didn't authorize the wizard");
  expect(screenText).not.toContain('Step 1 of 2');
  expect(screenText).not.toContain('Send your log too?');
  expect(screenText).toContain('Exit');
  expect(screenText).not.toContain('Save skill');
});

it('names the program it reruns when the run was not the integration', async () => {
  const { app, choose } = setup(ErrorCodes.AgentApiError, true, Program.Audit);
  await delay();
  expect(app.lastFrame()).toContain("The wizard didn't finish");
  await choose(1);
  const screenText = app.lastFrame()?.replace(/\s+/g, ' ');
  expect(screenText).toContain('npx @posthog/wizard@latest audit');
});

it('asks for the same command when the program has none of its own', async () => {
  const { app, choose } = setup(
    ErrorCodes.AgentApiError,
    true,
    Program.AgentSkill,
  );
  await delay();
  await choose(1);
  const screenText = app.lastFrame()?.replace(/\s+/g, ' ');
  expect(screenText).toContain('Run the same wizard command again.');
  expect(screenText).not.toContain('npx @posthog/wizard@latest');
});

it.each([
  [ErrorCodes.AgentOrchestratorTasksFailed, "PostHog isn't set up yet"],
  [ErrorCodes.AgentRateLimit, 'The wizard is busy right now'],
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

it("reports only this run's log lines when another run shares the log file", () => {
  const logPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-log-')),
    'posthog-wizard.log',
  );
  configureLogFile({ path: logPath, enabled: true });
  logToFile('this run started');
  fs.appendFileSync(logPath, 'another run read its secret source\n');
  logToFile(
    'this run failed with Bearer phx_logged_secret in /Users/alice/app',
  );
  const { store } = setup();
  const logTail = String(
    failureReportProperties(store.session, store.router.activeProgram).log_tail,
  );
  expect(logTail).toContain('this run failed');
  expect(logTail).not.toContain('another run');
  expect(logTail).not.toContain('phx_logged_secret');
  expect(logTail).not.toContain('alice');
});
