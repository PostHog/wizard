import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const projectData = vi.hoisted(() => vi.fn());
const cleanups = vi.hoisted(() => vi.fn());
const preRun = vi.hoisted(() => vi.fn());
vi.mock('@store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@store')>()),
  getOrAskForProjectData: projectData,
  runCleanups: cleanups,
}));
vi.mock('@store/programs', async (importOriginal) => {
  const original = await importOriginal<typeof import('@store/programs')>();
  return {
    ...original,
    getProgramConfig: (id: string) => {
      const config = original.getProgramConfig(id as never);
      // Metrics stands in for a program with a ciPreRun and a skill of its own.
      return id === original.Program.Metrics
        ? { ...config, ciPreRun: preRun, skillId: 'metrics-skill' }
        : config;
    },
  };
});
vi.mock('@store/shared/analytics', () => ({
  analytics: {
    setTag: vi.fn(),
    wizardCapture: vi.fn(),
    captureException: vi.fn(),
  },
  sessionProperties: () => ({}),
}));

import {
  buildSession,
  getUI,
  HostResolution,
  OutroKind,
  RunPhase,
  StoreUI,
  setUI,
} from '@store';
import { Program } from '@store/programs';
import type { WizardSession } from '@store/types';
import { createControlHooks } from '../control-hooks.js';
import { fakeRunAgent, fakeStartTUI } from '../testing/fake-surfaces.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  vi.clearAllMocks();
});

function setup(program = Program.PostHogIntegration) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wz-hooks-'));
  dirs.push(dir);
  const { store } = fakeStartTUI(program);
  setUI(new StoreUI(store));
  store.session = buildSession({
    installDir: dir,
    ci: true,
    apiKey: 'phx_key',
    projectId: '42',
  });
  store.setFrameworkContext('shared', 'live');
  const agent = fakeRunAgent();
  const shutdown = vi.fn(() => Promise.resolve());
  const streams: Array<{
    programId: string;
    attach: ReturnType<typeof vi.fn>;
    shutdown: ReturnType<typeof vi.fn>;
  }> = [];
  const runStream = vi.fn((config: { id: string }) => {
    const stream = {
      programId: config.id,
      attach: vi.fn(),
      shutdown: vi.fn(() => Promise.resolve()),
    };
    streams.push(stream);
    return stream;
  });
  const hooks = createControlHooks({
    store,
    programId: program,
    runAgent: agent.runAgent,
    runStream,
    shutdown,
  });
  return { store, hooks, agent, shutdown, streams, dir };
}

describe('credentials', () => {
  it('resolves the API key host side and commits the project credentials', async () => {
    const { store, hooks } = setup();
    projectData.mockResolvedValueOnce({
      accessToken: 'phx_key',
      projectApiKey: 'phc_project',
      host: HostResolution.fromApiHost('https://us.posthog.com'),
      projectId: 42,
    });
    await hooks.setCredentials();
    expect(projectData).toHaveBeenCalledWith(
      expect.objectContaining({
        ci: true,
        signup: false,
        apiKey: 'phx_key',
        projectId: 42,
        programId: Program.PostHogIntegration,
      }),
    );
    expect(store.session.credentials).toMatchObject({
      projectApiKey: 'phc_project',
      projectId: 42,
    });
  });
});

describe('one independent run', () => {
  it('scopes the run session and passes the request context explicitly', async () => {
    const { store, hooks, agent, dir } = setup();
    await hooks.startRun({
      programId: Program.Audit,
      installDir: 'apps/web',
      frameworkContext: { picked: 'yes' },
      skillId: 'audit-events',
    });
    expect(agent.calls).toEqual([
      {
        programId: Program.Audit,
        installDir: path.join(dir, 'apps/web'),
        frameworkContextKeys: ['shared', 'picked'],
        skillId: 'audit-events',
        composed: true,
      },
    ]);
    // The live session is untouched: the next run starts from the same place.
    expect(store.session.installDir).toBe(dir);
    expect(store.session.frameworkContext).toEqual({ shared: 'live' });
  });

  it('keeps an absolute install dir and falls back to the live one', async () => {
    const { hooks, agent, dir } = setup();
    await hooks.startRun({
      programId: Program.PostHogIntegration,
      installDir: '/abs/app',
    });
    await hooks.startRun({ programId: Program.PostHogIntegration });
    expect(agent.calls.map((c) => c.installDir)).toEqual(['/abs/app', dir]);
  });

  it('picks the skill from the request, then the program, then the live session', async () => {
    const { store, hooks, agent } = setup();
    store.session = { ...store.session, skillId: 'live-skill' };
    await hooks.startRun({ programId: Program.Audit, skillId: 'requested' });
    await hooks.startRun({ programId: Program.Metrics });
    await hooks.startRun({ programId: Program.PostHogIntegration });
    expect(agent.calls.map((c) => c.skillId)).toEqual([
      'requested',
      'metrics-skill',
      'live-skill',
    ]);
  });

  it('gives each run its own stream and a clean run state, and restores the user files', async () => {
    const { store, hooks, streams } = setup();
    store.setDashboardUrl('https://us.posthog.com/project/1/dashboard/9');
    store.setTasks([{ label: 'stale', status: 'completed' } as never]);
    store.setRunPhase(RunPhase.Completed);
    await hooks.startRun({ programId: Program.Metrics });
    await hooks.startRun({ programId: Program.Audit });
    expect(streams.map((s) => s.programId)).toEqual([
      Program.Metrics,
      Program.Audit,
    ]);
    for (const stream of streams) {
      expect(stream.attach).toHaveBeenCalledTimes(1);
      expect(stream.shutdown).toHaveBeenCalledWith(2000);
    }
    expect(cleanups).toHaveBeenCalledTimes(2);
    expect(store.session.dashboardUrl).toBe(
      'https://us.posthog.com/project/1/dashboard/9',
    );
    expect(store.tasks).toEqual([]);
    expect(store.session.runPhase).toBe(RunPhase.Completed);
  });

  it('lays the request config over the program before the agent and the stream read it', async () => {
    const { store, streams } = setup();
    const seen: Array<Record<string, unknown>> = [];
    const hooks = createControlHooks({
      store,
      programId: Program.PostHogIntegration,
      runAgent: (config) => {
        seen.push({
          id: config.id,
          allowedTools: config.allowedTools,
          requiresAi: config.requiresAi,
          agentFlow: config.agentFlow,
        });
        return Promise.resolve();
      },
      runStream: (config) => {
        const stream = {
          programId: config.streamWorkflowId ?? config.id,
          attach: vi.fn(),
          shutdown: vi.fn(() => Promise.resolve()),
        };
        streams.push(stream);
        return stream;
      },
      shutdown: () => Promise.resolve(),
    });
    await hooks.startRun({
      programId: Program.Audit,
      config: {
        allowedTools: ['Read'],
        requiresAi: false,
        streamWorkflowId: 'audit-custom',
      },
    });
    expect(seen).toEqual([
      {
        id: Program.Audit,
        allowedTools: ['Read'],
        requiresAi: false,
        agentFlow: undefined,
      },
    ]);
    expect(streams.at(-1)?.programId).toBe('audit-custom');
  });

  it('is in flight before the agent starts and completed after it returns', async () => {
    const { store } = setup();
    let seen: RunPhase | null = null;
    const hooks = createControlHooks({
      store,
      programId: Program.PostHogIntegration,
      runAgent: () => {
        seen = store.session.runPhase;
        return Promise.resolve();
      },
      shutdown: () => Promise.resolve(),
    });
    await hooks.startRun({ programId: Program.PostHogIntegration });
    expect(seen).toBe(RunPhase.Running);
    expect(store.session.runPhase).toBe(RunPhase.Completed);
  });

  it('records an error outro when the agent throws without one, and still closes the stream', async () => {
    const { store, streams } = setup();
    const failing = createControlHooks({
      store,
      programId: Program.PostHogIntegration,
      runAgent: () => Promise.reject(new Error('gateway refused')),
      runStream: () => {
        const stream = {
          programId: 'x',
          attach: vi.fn(),
          shutdown: vi.fn(() => Promise.resolve()),
        };
        streams.push(stream);
        return stream;
      },
      shutdown: () => Promise.resolve(),
    });
    await expect(
      failing.startRun({ programId: Program.PostHogIntegration }),
    ).rejects.toThrow('gateway refused');
    expect(store.session.runPhase).toBe(RunPhase.Error);
    expect(store.session.outroData).toEqual({
      kind: OutroKind.Error,
      message: 'gateway refused',
    });
    expect(streams[0].shutdown).toHaveBeenCalledTimes(1);
    expect(cleanups).toHaveBeenCalledTimes(1);
  });

  it("keeps the agent's own error outro when it already set one", async () => {
    const { store } = setup();
    const hooks = createControlHooks({
      store,
      programId: Program.PostHogIntegration,
      runAgent: () => {
        store.setOutroData({
          kind: OutroKind.Error,
          message: 'agent said so',
          errorCode: 'PHW_AGENT_YARA_VIOLATION' as never,
        });
        store.setRunPhase(RunPhase.Error);
        return Promise.reject(new Error('aborted'));
      },
      shutdown: () => Promise.resolve(),
    });
    await expect(
      hooks.startRun({ programId: Program.PostHogIntegration }),
    ).rejects.toThrow('aborted');
    expect(store.session.outroData).toMatchObject({
      message: 'agent said so',
      errorCode: 'PHW_AGENT_YARA_VIOLATION',
    });
  });
});

describe('detection', () => {
  it("runs the launched program's ready hooks when it declares no ciPreRun", async () => {
    // Audit declares no ciPreRun, so detection is the store's onReady walk.
    const { store, hooks } = setup(Program.Audit);
    const ready = vi.spyOn(store, 'runReadyHooks');
    await hooks.detect({});
    expect(ready).toHaveBeenCalledTimes(1);
    expect(preRun).not.toHaveBeenCalled();
  });

  it('publishes both what ciPreRun wrote directly and what it committed through setters', async () => {
    const { store, hooks } = setup(Program.Metrics);
    preRun.mockImplementationOnce(async (session: WizardSession) => {
      getUI().setCredentials({
        accessToken: 'phx_x',
        projectApiKey: 'phc_x',
        host: HostResolution.fromApiHost('https://us.posthog.com'),
        projectId: 9,
      });
      session.typescript = true;
      session.integration = 'javascript_node' as never;
      await Promise.resolve();
    });
    await hooks.detect({});
    expect(preRun).toHaveBeenCalledTimes(1);
    expect(store.session.credentials?.projectId).toBe(9);
    expect(store.session.typescript).toBe(true);
    expect(store.session.integration).toBe('javascript_node');
    expect(store.session.detectionComplete).toBe(true);
  });

  it('switches program and install dir on request', async () => {
    const { store, hooks, dir } = setup();
    fs.mkdirSync(path.join(dir, 'sub'));
    await hooks.detect({ programId: Program.Audit, installDir: 'sub' });
    expect(store.activeProgram).toBe(Program.Audit);
    expect(store.session.installDir).toBe(path.join(dir, 'sub'));
  });
});

describe('shutdown', () => {
  it('defers to the runner', async () => {
    const { hooks, shutdown } = setup();
    await hooks.shutdown();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});
