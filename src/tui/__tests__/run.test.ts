import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { vi, it, expect, afterEach } from 'vitest';
import { ControlClient } from '@host/control';
import type { ControlHooks } from '@shared/control/types';
import { ProgramAbort, RunOutcome, runProgram } from '@programs';
import type { TuiLaunch } from '@tui/launch';
import { runTui } from '@tui/run';
import { runTuiTool } from '@tui/run-tool';
import { getOrAskForProjectData } from '@tui/auth/project-data';
import { PosthogDoctorScreenId } from '@tui/tools/doctor';
import { startTUI } from '@tui/start-tui';
import { WizardStore } from '@tui/store';
import { config as posthogIntegration } from '@programs/posthog-integration';
import { ScreenId } from '@tui/router';
import { ErrorCodes } from '@shared/errors';
import { HostResolution } from '@shared/host-resolution';
import { analytics } from '@utils/analytics';
import { RunPhase } from '@shared/run-state';
import { Tool } from '@tools';

const streamShutdown = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock(import('@programs'), async (original) => ({
  ...(await original()),
  runProgram: vi.fn(),
  TaskStreamPush: class {
    attach = vi.fn();
    finishRun = vi.fn().mockResolvedValue(undefined);
    shutdown = streamShutdown;
  } as never,
  PostHogDestination: class {} as never,
}));
vi.mock(import('@tui/start-tui'), () => ({ startTUI: vi.fn() }));
vi.mock(import('@shared/local-dev'), async (original) => ({
  ...(await original()),
  getLocalDev: () => ({} as never),
  checkLocalServices: () => Promise.resolve(null) as never,
}));
vi.mock(import('@utils/analytics'), () => ({
  analytics: {
    wizardCapture: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
    setTag: vi.fn(),
    setGroups: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  } as never,
  groupsFromUser: () => ({}),
  sessionProperties: () => ({}),
}));
vi.mock(import('@tui/auth/project-data'), () => ({
  getOrAskForProjectData: vi.fn(),
}));

const launch = (installDir: string): TuiLaunch => ({
  session: { installDir, noTelemetry: true },
  signal: new AbortController().signal,
});

/** A launch whose SIGTERM already fired, as the CLI's signal is while it loads the host. */
const aborted = (): TuiLaunch => {
  const controller = new AbortController();
  controller.abort('SIGTERM');
  return {
    session: { installDir: '/tmp/aborted-test' },
    signal: controller.signal,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

/** A store startTUI hands out, with detection and the gates already through. */
function mountedStore(program: string = posthogIntegration.id): {
  store: WizardStore;
  unmount: ReturnType<typeof vi.fn>;
} {
  const store = new WizardStore(program);
  vi.spyOn(store, 'runReadyHooks').mockResolvedValue(undefined);
  vi.spyOn(store, 'getGate').mockResolvedValue(undefined);
  const unmount = vi.fn();
  vi.mocked(startTUI).mockReturnValue({
    store,
    unmount,
    waitForSetup: () => Promise.resolve(),
  });
  return { store, unmount };
}

const loggedIn = (store: WizardStore): void =>
  store.setCredentials({
    accessToken: 'tok',
    projectApiKey: 'pk',
    host: HostResolution.fromApiHost('https://app.posthog.com'),
    projectId: 1,
  });

it.each(['continue', 'exit'] as const)(
  'catches a failed run, shows the handoff screen, and exits 1 after %s',
  async (action) => {
    const store = new WizardStore(posthogIntegration.id);
    vi.spyOn(store, 'runReadyHooks').mockResolvedValue(undefined);
    vi.spyOn(store, 'getGate').mockResolvedValue(undefined);
    const unmount = vi.fn();
    vi.mocked(startTUI).mockReturnValue({
      store,
      unmount,
      waitForSetup: () => Promise.resolve(),
    });
    // runTui installs its own session first; the login then sets credentials,
    // and the agent dies after that.
    vi.mocked(runProgram).mockImplementation(() => {
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: HostResolution.fromApiHost('https://app.posthog.com'),
        projectId: 1,
      });
      return Promise.reject(new Error('agent exploded'));
    });
    let code: number | undefined;
    void runTui(posthogIntegration, launch('/tmp/handoff-test')).then(
      (exit) => {
        code = exit;
      },
    );

    await vi.waitFor(() =>
      expect(store.currentScreen).toBe(ScreenId.MintFailure),
    );
    expect(unmount).not.toHaveBeenCalled();
    expect(code).toBeUndefined();
    if (action === 'continue') {
      store.setMintHandoff('continue');
      expect(store.currentScreen).toBe(ScreenId.Mcp);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(code).toBeUndefined();
      store.setSkillsComplete(true);
    } else {
      store.setMintHandoff('exit');
    }
    await vi.waitFor(() => expect(code).toBe(1));
    expect(unmount).toHaveBeenCalledOnce();
    expect(analytics.shutdown).toHaveBeenCalledWith('error');
  },
);

it('routes Ink cancellation through one cancelled shutdown and preserves exit 130', async () => {
  const store = new WizardStore(posthogIntegration.id);
  vi.spyOn(store, 'runReadyHooks').mockResolvedValue(undefined);
  vi.spyOn(store, 'getGate').mockResolvedValue(undefined);
  const unmount = vi.fn();
  vi.mocked(startTUI).mockReturnValue({
    store,
    unmount,
    waitForSetup: () => Promise.resolve(),
  });
  vi.mocked(runProgram).mockImplementation(() => {
    store.setRunPhase(RunPhase.Running);
    return new Promise(() => undefined);
  });
  const exited = runTui(posthogIntegration, launch('/tmp/cancellation-test'));
  await vi.waitFor(() => expect(runProgram).toHaveBeenCalled());
  const interrupt = vi.mocked(startTUI).mock.calls[0][2];
  interrupt?.();
  interrupt?.();
  await expect(exited).resolves.toBe(130);
  expect(streamShutdown).toHaveBeenCalledExactlyOnceWith(2000, 'cancelled');
  expect(analytics.shutdown).toHaveBeenCalledWith('cancelled');
  expect(unmount).toHaveBeenCalledOnce();
});

it("resolves a screen's exit request with its code and starts no end shutdown", async () => {
  const { store, unmount } = mountedStore();
  vi.mocked(runProgram).mockResolvedValue({
    outcome: RunOutcome.Success,
    diagnostics: [],
  } as never);
  const exited = runTui(posthogIntegration, launch('/tmp/screen-exit-test'));
  await vi.waitFor(() => expect(runProgram).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 10));
  // KeepSkills after a success: the end-wait holds, then the screen exits.
  store.setSkillsComplete(true);
  store.requestExit(0);
  await expect(exited).resolves.toBe(0);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(streamShutdown).not.toHaveBeenCalled();
  expect(unmount).not.toHaveBeenCalled();
});

it('resolves an abort with its code once its outro is dismissed', async () => {
  const { store } = mountedStore();
  vi.mocked(store.runReadyHooks).mockRejectedValue(
    new ProgramAbort({ code: ErrorCodes.DetectNoFramework, message: 'none' }),
  );
  let code: number | undefined;
  void runTui(posthogIntegration, launch('/tmp/abort-test')).then((c) => {
    code = c;
  });
  await vi.waitFor(() => expect(store.session.outroData).not.toBeNull());
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(code).toBeUndefined();
  store.setOutroDismissed();
  await vi.waitFor(() => expect(code).toBe(1));
  expect(analytics.shutdown).toHaveBeenCalledWith('cancelled');
});

it.each(['continue', 'exit'] as const)(
  'ends a decided failure after login with 1 once the user leaves the handoff screen by %s',
  async (action) => {
    const { store } = mountedStore();
    vi.mocked(runProgram).mockImplementation(() => {
      loggedIn(store);
      return Promise.resolve({
        outcome: RunOutcome.Failed,
        failure: { code: ErrorCodes.AgentApiError, message: 'Failed' },
        diagnostics: [],
      } as never);
    });
    let code: number | undefined;
    void runTui(posthogIntegration, launch('/tmp/mint-park-test')).then((c) => {
      code = c;
    });
    await vi.waitFor(() =>
      expect(store.currentScreen).toBe(ScreenId.MintFailure),
    );
    expect(code).toBeUndefined();
    store.setMintHandoff(action);
    if (action === 'continue') store.setSkillsComplete(true);
    await vi.waitFor(() => expect(code).toBe(1));
  },
);

/** The OAuth login doctor's screens resolve. */
const doctorLogin = (): void => {
  vi.mocked(getOrAskForProjectData).mockResolvedValue({
    host: HostResolution.fromApiHost('https://us.posthog.com'),
    projectApiKey: 'phc_doctor',
    accessToken: 'pha_doctor',
    projectId: 7,
    roleAtOrganization: null,
    user: null,
    project: null,
    missingScopes: [],
  });
};

it.each([
  ['Ctrl+C', 130],
  ['SIGTERM', 143],
] as const)(
  'runTuiTool on %s restores the terminal, shuts analytics down as cancelled, and resolves %i',
  async (how, code) => {
    const { unmount } = mountedStore(Tool.McpAdd);
    const controller = new AbortController();
    const exited = runTuiTool(Tool.McpAdd, {
      session: { installDir: '/tmp/screens-test' },
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(startTUI).toHaveBeenCalled());
    if (how === 'SIGTERM') controller.abort('SIGTERM');
    else vi.mocked(startTUI).mock.calls[0][2]();
    await expect(exited).resolves.toBe(code);
    expect(unmount).toHaveBeenCalledOnce();
    expect(analytics.shutdown).toHaveBeenCalledExactlyOnceWith('cancelled');
  },
);

it.each([
  ['runTui', () => runTui(posthogIntegration, aborted())],
  [
    'runTuiTool',
    () =>
      runTuiTool(Tool.McpAdd, {
        session: { installDir: '/tmp/screens-test' },
        signal: aborted().signal,
      }),
  ],
])(
  '%s resolves 143 for a SIGTERM that landed before it subscribed',
  async (_host, run) => {
    mountedStore(Tool.McpAdd);
    await expect(run()).resolves.toBe(143);
    expect(startTUI).not.toHaveBeenCalled();
  },
);

it("runTuiTool resolves a screen's exit request with its code once analytics flush", async () => {
  const { store, unmount } = mountedStore(Tool.McpAdd);
  const exited = runTuiTool(Tool.McpAdd, {
    session: { installDir: '/tmp/screens-test', localMcp: true },
    signal: new AbortController().signal,
  });
  await vi.waitFor(() => expect(store.session.localMcp).toBe(true));
  store.requestExit(1);
  await expect(exited).resolves.toBe(1);
  expect(unmount).toHaveBeenCalledOnce();
  expect(analytics.flush).toHaveBeenCalled();
  expect(analytics.shutdown).not.toHaveBeenCalled();
});

it('runTuiTool logs doctor in only once its intro and health check pass', async () => {
  const { store } = mountedStore(Tool.PosthogDoctor);
  doctorLogin();
  let passHealthCheck!: () => void;
  const healthCheck = new Promise<void>((resolve) => {
    passHealthCheck = resolve;
  });
  vi.mocked(store.getGate).mockImplementation((step) =>
    step === 'health-check' ? healthCheck : Promise.resolve(),
  );
  void runTuiTool(Tool.PosthogDoctor, {
    session: { installDir: '/tmp/doctor-test' },
    signal: new AbortController().signal,
  });
  await vi.waitFor(() => expect(store.getGate).toHaveBeenCalledWith('intro'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(getOrAskForProjectData).not.toHaveBeenCalled();
  passHealthCheck();
  await vi.waitFor(() =>
    expect(store.session.credentials?.accessToken).toBe('pha_doctor'),
  );
  expect(getOrAskForProjectData).toHaveBeenCalledWith(
    expect.objectContaining({ programId: Tool.PosthogDoctor }),
  );
});

it("hands the intro's switch to a tool over to its screens, with no program run", async () => {
  const { store, unmount } = mountedStore();
  doctorLogin();
  // The user picks doctor in the spell book while the intro gate holds.
  vi.mocked(store.getGate).mockImplementation((step) => {
    if (step === 'intro' && store.router.activeProgram !== Tool.PosthogDoctor) {
      store.switchProgram(Tool.PosthogDoctor);
    }
    return Promise.resolve();
  });
  const exited = runTui(posthogIntegration, launch('/tmp/handoff-tool-test'));
  await vi.waitFor(() =>
    expect(store.currentScreen).toBe(PosthogDoctorScreenId.Intro),
  );
  store.requestExit(0);
  await expect(exited).resolves.toBe(0);
  expect(runProgram).not.toHaveBeenCalled();
  expect(streamShutdown).not.toHaveBeenCalled();
  expect(unmount).toHaveBeenCalledOnce();
  expect(analytics.flush).toHaveBeenCalled();
});

it('a controlled TUI serves its store on the socket and exits 0 on shutdown', async () => {
  const { store, unmount } = mountedStore();
  // Parked on the intro: the parent drives the run.
  vi.mocked(store.getGate).mockReturnValue(new Promise(() => undefined));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wz-tui-ctl-'));
  const socketPath = path.join(dir, 'c.sock');
  try {
    const exited = runTui(posthogIntegration, {
      ...launch(dir),
      control: { socketPath, mode: 'partial' },
    });
    await vi.waitFor(() => expect(fs.existsSync(socketPath)).toBe(true));
    const client = new ControlClient(socketPath);
    await expect(client.health()).resolves.toMatchObject({
      surface: 'tui',
      mode: 'partial',
      program: posthogIntegration.id,
    });
    await client.shutdown();
    await expect(exited).resolves.toBe(0);
    expect(unmount).toHaveBeenCalledOnce();
    expect(runProgram).not.toHaveBeenCalled();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it('logs in with launch.credentials, not OAuth, for the run and the control hook', async () => {
  const { store } = mountedStore();
  vi.mocked(runProgram).mockReturnValue(new Promise(() => undefined));
  const login = {
    posthog: {
      accessToken: 'phx_launch',
      projectApiKey: 'phc_launch',
      host: HostResolution.fromApiHost('https://us.posthog.com'),
      projectId: 3,
    },
    project: null,
    apiUser: null,
  };
  const credentials = { resolve: vi.fn().mockResolvedValue(login) };
  let hooks: ControlHooks | undefined;
  void runTui(posthogIntegration, {
    ...launch('/tmp/launch-credentials-test'),
    credentials,
    control: { attach: (_target, attached) => (hooks = attached) },
  });
  await vi.waitFor(() => expect(runProgram).toHaveBeenCalled());
  const run = vi.mocked(runProgram).mock.calls[0][2]!;
  await expect(
    run.credentials!.resolve(posthogIntegration.id, {
      signal: new AbortController().signal,
    }),
  ).resolves.toBe(login);
  await hooks!.setCredentials();
  expect(store.session.credentials?.accessToken).toBe('phx_launch');
  expect(credentials.resolve).toHaveBeenCalledTimes(2);
  expect(getOrAskForProjectData).not.toHaveBeenCalled();
});
