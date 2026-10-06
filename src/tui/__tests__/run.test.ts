import { vi, it, expect, afterEach } from 'vitest';
import { ProgramAbort, RunOutcome, runProgram } from '@programs';
import type { TuiLaunch } from '@tui/launch';
import { runTui } from '@tui/run';
import { runTuiTool } from '@tui/run-tool';
import { getOrAskForProjectData } from '@tui/auth/project-data';
import { PosthogDoctorScreenId } from '@tui/tools/doctor';
import { startTUI } from '@tui/start-tui';
import { WizardStore } from '@tui/store';
import { config as posthogIntegration } from '@programs/posthog-integration';
import { checkLocalServices } from '@shared/local-dev';
import { ScreenId } from '@tui/router';
import { ErrorCodes } from '@shared/errors';
import { HostResolution } from '@shared/host-resolution';
import { analytics } from '@utils/analytics';
import { registerCleanup } from '@utils/cleanup';
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
  checkLocalServices: vi.fn(() => Promise.resolve(null) as never),
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

/** Lets the promise chains already queued run. */
const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

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
    const { store, unmount } = mountedStore();
    // runTui installs its own session first; the login then sets credentials,
    // and the agent dies after that.
    vi.mocked(runProgram).mockImplementation(() => {
      loggedIn(store);
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
      await flush();
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
  const { store, unmount } = mountedStore();
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

it.each([
  ['SIGINT', 130],
  ['SIGTERM', 143],
  ['SIGHUP', 130],
] as const)(
  'a %s cancels the run and runs the cleanups before the stream flush, then resolves %i',
  async (name, code) => {
    const { store, unmount } = mountedStore();
    const controller = new AbortController();
    const cleanup = vi.fn();
    registerCleanup(cleanup);
    let runSignal: AbortSignal | undefined;
    // The run ends Aborted once its signal fires, as a real one does.
    vi.mocked(runProgram).mockImplementation((_id, _input, options) => {
      store.setRunPhase(RunPhase.Running);
      runSignal = options?.signal;
      return new Promise((resolve) =>
        runSignal?.addEventListener('abort', () =>
          resolve({ outcome: RunOutcome.Aborted, diagnostics: [] } as never),
        ),
      );
    });
    const exited = runTui(posthogIntegration, {
      ...launch('/tmp/signal-test'),
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(runProgram).toHaveBeenCalled());
    controller.abort(name);
    await expect(exited).resolves.toBe(code);
    expect(runSignal?.aborted).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(streamShutdown).toHaveBeenCalledExactlyOnceWith(2000, 'cancelled');
    // The settings restore is sync, so it runs before a flush that may time out.
    expect(cleanup.mock.invocationCallOrder[0]).toBeLessThan(
      streamShutdown.mock.invocationCallOrder[0],
    );
    expect(analytics.shutdown).toHaveBeenCalledWith('cancelled');
    expect(unmount).toHaveBeenCalledOnce();
  },
);

it("resolves a screen's exit request with its code and starts no stream shutdown", async () => {
  const { store, unmount } = mountedStore();
  vi.mocked(runProgram).mockResolvedValue({
    outcome: RunOutcome.Success,
    diagnostics: [],
  } as never);
  const exited = runTui(posthogIntegration, launch('/tmp/screen-exit-test'));
  await vi.waitFor(() => expect(runProgram).toHaveBeenCalled());
  await flush();
  // KeepSkills after a success: the end-wait holds, then the screen exits.
  store.setSkillsComplete(true);
  store.requestExit(0);
  await expect(exited).resolves.toBe(0);
  await flush();
  expect(streamShutdown).not.toHaveBeenCalled();
  expect(unmount).toHaveBeenCalledOnce();
});

it.each([
  [0, 'cancelled'],
  [1, 'error'],
] as const)(
  'ends a screen exit request %i before the run with a %s shutdown, delivered before the exit',
  async (code, status) => {
    const { store, unmount } = mountedStore();
    // The intro never settles: the user leaves from its menu.
    vi.spyOn(store, 'getGate').mockReturnValue(new Promise(() => undefined));
    let delivered = false;
    vi.mocked(analytics.flush).mockImplementation(async () => {
      // The screen is gone before the wait, so it takes no more input.
      expect(unmount).toHaveBeenCalledOnce();
      await flush();
      delivered = true;
    });
    const exited = runTui(posthogIntegration, launch('/tmp/intro-exit-test'));
    await vi.waitFor(() => expect(store.getGate).toHaveBeenCalled());
    store.requestExit(code);
    await expect(exited).resolves.toBe(code);
    expect(delivered).toBe(true);
    expect(analytics.shutdown).toHaveBeenCalledExactlyOnceWith(status);
    expect(runProgram).not.toHaveBeenCalled();
  },
);

it('exits on a screen exit request within the report budget when analytics hang', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  try {
    const { store } = mountedStore();
    vi.spyOn(store, 'getGate').mockReturnValue(new Promise(() => undefined));
    vi.mocked(analytics.shutdown).mockReturnValue(new Promise(() => undefined));
    const exited = runTui(posthogIntegration, launch('/tmp/hung-exit-test'));
    await vi.waitFor(() => expect(store.getGate).toHaveBeenCalled());
    store.requestExit(0);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(exited).resolves.toBe(0);
  } finally {
    vi.useRealTimers();
  }
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
  await flush();
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

it.each([
  [Tool.McpAdd, 0, null],
  [Tool.PosthogDoctor, 1, Tool.PosthogDoctor],
] as const)(
  'runTuiTool on %s makes %i local service probes and labels its exit line %s, as main did',
  async (toolId, probes, label) => {
    const { store } = mountedStore(toolId);
    doctorLogin();
    const exited = runTuiTool(toolId, {
      session: { installDir: '/tmp/tool-label-test' },
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => expect(startTUI).toHaveBeenCalled());
    expect(checkLocalServices).toHaveBeenCalledTimes(probes);
    expect(store.programLabel).toBe(label);
    store.requestExit(0);
    await exited;
  },
);

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
  await flush();
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

it('logs in with launch.credentials, not OAuth, for the run', async () => {
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
  const onStore = vi.fn();
  void runTui(posthogIntegration, {
    ...launch('/tmp/launch-credentials-test'),
    credentials,
    onStore,
  });
  await vi.waitFor(() => expect(runProgram).toHaveBeenCalled());
  const run = vi.mocked(runProgram).mock.calls[0][2]!;
  await expect(
    run.credentials!.resolve(posthogIntegration.id, {
      signal: new AbortController().signal,
    }),
  ).resolves.toBe(login);
  expect(credentials.resolve).toHaveBeenCalledTimes(1);
  expect(onStore).toHaveBeenCalledWith(store);
  expect(getOrAskForProjectData).not.toHaveBeenCalled();
});
