import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const projectData = vi.hoisted(() => vi.fn());
vi.mock('@store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@store')>()),
  getOrAskForProjectData: projectData,
}));
vi.mock('@store/shared/analytics', () => ({
  analytics: {
    setTag: vi.fn(),
    wizardCapture: vi.fn(),
    captureException: vi.fn(),
  },
  sessionProperties: () => ({}),
}));

import { buildSession, OutroKind, RunPhase, StoreUI, setUI } from '@store';
import { Program } from '@store/programs';
import { createControlHooks } from '../control-hooks.js';
import { fakeRunAgent, fakeStartTUI } from '../testing/fake-surfaces.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
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

describe('control hooks', () => {
  it('setCredentials resolves the API key and commits it', async () => {
    const { store, hooks } = setup();
    projectData.mockResolvedValueOnce({
      accessToken: 'phx_key',
      projectApiKey: 'phc_project',
      host: { region: 'us' },
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

  it('startRun scopes one independent run and passes context explicitly', async () => {
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
        composed: true,
      },
    ]);
    // The live session is untouched: the next run starts from the same place.
    expect(store.session.installDir).toBe(dir);
    expect(store.session.frameworkContext).toEqual({ shared: 'live' });
  });

  it('startRun keeps an absolute install dir and falls back to the live one', async () => {
    const { hooks, agent, dir } = setup();
    await hooks.startRun({
      programId: Program.PostHogIntegration,
      installDir: '/abs/app',
    });
    await hooks.startRun({ programId: Program.PostHogIntegration });
    expect(agent.calls.map((c) => c.installDir)).toEqual(['/abs/app', dir]);
  });

  it("detect runs the launched program's ready hooks against the store", async () => {
    // Audit declares no ciPreRun, so detection is the store's onReady walk.
    const { store, hooks } = setup(Program.Audit);
    const before = store.getVersion();
    await hooks.detect({});
    expect(store.activeProgram).toBe(Program.Audit);
    expect(store.getVersion()).toBeGreaterThanOrEqual(before);
  });

  it('detect switches program and install dir on request', async () => {
    const { store, hooks, dir } = setup();
    fs.mkdirSync(path.join(dir, 'sub'));
    await hooks.detect({ programId: Program.Audit, installDir: 'sub' });
    expect(store.activeProgram).toBe(Program.Audit);
    expect(store.session.installDir).toBe(path.join(dir, 'sub'));
  });

  it('shutdown defers to the runner', async () => {
    const { hooks, shutdown } = setup();
    await hooks.shutdown();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});

describe('independent runs', () => {
  it('each run gets its own stream and a clean run state', async () => {
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
    expect(store.session.dashboardUrl).toBeNull();
    expect(store.tasks).toEqual([]);
    expect(store.session.runPhase).toBe(RunPhase.Completed);
  });

  it('a run that throws leaves an error outro and still closes its stream', async () => {
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
  });
});

describe('run settlement', () => {
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

  it('marks a run that ended while running as completed', async () => {
    const { store } = setup();
    const hooks = createControlHooks({
      store,
      programId: Program.PostHogIntegration,
      runAgent: () => {
        store.setRunPhase(RunPhase.Running);
        return Promise.resolve();
      },
      shutdown: () => Promise.resolve(),
    });
    await hooks.startRun({ programId: Program.PostHogIntegration });
    expect(store.session.runPhase).toBe(RunPhase.Completed);
  });
});
