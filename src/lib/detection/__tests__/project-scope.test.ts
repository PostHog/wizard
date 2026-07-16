import {
  detectProjectsWithAgent,
  type AgenticProject,
} from '@lib/detection/agentic';
import {
  chooseIntegrationProject,
  scopeInstallDirToProject,
} from '@lib/detection/project-scope';
import {
  AGENTIC_DETECTION_TIMEOUT_MS,
  WIZARD_BASIC_INTEGRATION_AGENTIC_DETECTION_FLAG_KEY,
} from '@lib/constants';
import { authenticate } from '@lib/agent/runner/shared/authenticate';
import { buildSession } from '@lib/wizard-session';
import { analytics } from '@utils/analytics';

// Mock only the two network edges of scopeInstallDirToProject; everything else runs real.
vi.mock('@lib/agent/runner/shared/authenticate', () => ({
  authenticate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@lib/detection/agentic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lib/detection/agentic')>()),
  detectProjectsWithAgent: vi.fn(),
}));

const project = (overrides: Partial<AgenticProject>): AgenticProject => ({
  path: '.',
  framework: 'Unknown',
  targetId: null,
  hasPostHog: false,
  ...overrides,
});

describe('chooseIntegrationProject', () => {
  const api = project({
    path: 'apps/api',
    framework: 'Express',
    targetId: 'javascript_node',
  });
  const web = project({
    path: 'apps/web',
    framework: 'Next.js',
    targetId: 'nextjs',
    recommended: true,
  });

  it('picks the recommended project when its framework is supported', () => {
    expect(chooseIntegrationProject([api, web])?.path).toBe('apps/web');
  });

  it('picks the recommended project even when it already has PostHog', () => {
    // The main app wins — skipping it would silently instrument a secondary project instead.
    const withPostHog = { ...web, hasPostHog: true };
    expect(chooseIntegrationProject([api, withPostHog])?.path).toBe('apps/web');
  });

  it('skips an unsupported recommended project for the first supported fresh one', () => {
    const unsupported = project({
      path: 'ios',
      framework: 'Cordova',
      recommended: true,
    });
    expect(chooseIntegrationProject([unsupported, api])?.path).toBe('apps/api');
  });

  it('returns undefined when no project qualifies', () => {
    const unsupported = project({ path: 'crates/core', framework: 'Rust' });
    const instrumented = { ...api, hasPostHog: true };
    expect(chooseIntegrationProject([unsupported, instrumented])).toBe(
      undefined,
    );
    expect(chooseIntegrationProject([])).toBe(undefined);
  });
});

describe('scopeInstallDirToProject', () => {
  const scan = vi.mocked(detectProjectsWithAgent);
  const FLAG_ON = {
    [WIZARD_BASIC_INTEGRATION_AGENTIC_DETECTION_FLAG_KEY]: 'true',
  };
  const web = project({
    path: 'apps/web',
    framework: 'Next.js',
    targetId: 'nextjs',
    recommended: true,
  });

  let flagsSpy: ReturnType<typeof vi.spyOn>;
  let captureSpy: ReturnType<typeof vi.spyOn>;
  let exceptionSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    flagsSpy = vi
      .spyOn(analytics, 'getAllFlagsForWizard')
      .mockResolvedValue({});
    captureSpy = vi
      .spyOn(analytics, 'wizardCapture')
      .mockImplementation(() => undefined);
    exceptionSpy = vi
      .spyOn(analytics, 'captureException')
      .mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const outcomeEvent = () => {
    // Every path fires exactly one `agentic detection` event — funnels on outcome see every run.
    const calls = captureSpy.mock.calls.filter(
      ([name]) => name === 'agentic detection',
    );
    expect(calls).toHaveLength(1);
    return calls[0][1] as Record<string, unknown>;
  };

  it('fires flag-off and never scans when the flag is off (or the fetch failed)', async () => {
    // A failed flag fetch surfaces as an empty map, so this path also covers "flags unavailable".
    const session = buildSession({ installDir: '/repo' });
    await scopeInstallDirToProject(session);

    expect(vi.mocked(authenticate)).toHaveBeenCalledTimes(1);
    expect(session.installDir).toBe('/repo');
    expect(outcomeEvent()).toMatchObject({ outcome: 'flag-off' });
    expect(scan).not.toHaveBeenCalled();
  });

  it('re-points installDir at the recommended project and fires recommended with scan facts', async () => {
    flagsSpy.mockResolvedValue(FLAG_ON);
    scan.mockResolvedValue({ repoType: 'monorepo', projects: [web] });
    const session = buildSession({ installDir: '/repo' });
    await scopeInstallDirToProject(session);

    expect(session.installDir).toBe('/repo/apps/web');
    expect(outcomeEvent()).toMatchObject({
      outcome: 'recommended',
      repo_type: 'monorepo',
      project_count: 1,
      supported_count: 1,
      has_recommendation: true,
      chosen_framework: 'nextjs',
      chosen_path: 'apps/web',
      recommended_path: 'apps/web',
      recommended_framework: 'nextjs',
    });
  });

  it('carries every scanned project on the event, not just the counts', async () => {
    // The rollout needs to see what the scan saw — unsupported projects included.
    flagsSpy.mockResolvedValue(FLAG_ON);
    const rust = project({ path: 'crates/core', framework: 'Rust' });
    scan.mockResolvedValue({ repoType: 'monorepo', projects: [rust, web] });
    const session = buildSession({ installDir: '/repo' });
    await scopeInstallDirToProject(session);

    expect(outcomeEvent().projects).toEqual([
      {
        path: 'crates/core',
        framework: 'Rust',
        target_id: null,
        has_posthog: false,
        recommended: false,
      },
      {
        path: 'apps/web',
        framework: 'Next.js',
        target_id: 'nextjs',
        has_posthog: false,
        recommended: true,
      },
    ]);
  });

  it('fires first-instrumentable when the fallback pick wins', async () => {
    flagsSpy.mockResolvedValue(FLAG_ON);
    scan.mockResolvedValue({
      repoType: 'monorepo',
      projects: [
        project({ path: 'apps/api', framework: 'Express', targetId: 'node' }),
      ],
    });
    const session = buildSession({ installDir: '/repo' });
    await scopeInstallDirToProject(session);

    expect(session.installDir).toBe('/repo/apps/api');
    expect(outcomeEvent()).toMatchObject({
      outcome: 'first-instrumentable',
      has_recommendation: false,
      recommended_path: null,
      recommended_framework: null,
    });
  });

  it('leaves the session untouched, fires error, and reports the exception when the scan throws', async () => {
    flagsSpy.mockResolvedValue(FLAG_ON);
    const failure = new Error('agent unavailable');
    scan.mockRejectedValue(failure);
    const session = buildSession({ installDir: '/repo' });
    await scopeInstallDirToProject(session);

    expect(session.installDir).toBe('/repo');
    expect(outcomeEvent()).toMatchObject({
      outcome: 'error',
      error_message: 'agent unavailable',
    });
    expect(exceptionSpy).toHaveBeenCalledWith(failure, {
      step: 'agentic_detection',
    });
  });

  it('reports the recommendation it rejected when falling back to the first instrumentable', async () => {
    // Without this you can see the fallback fired but never what was recommended or why it lost.
    flagsSpy.mockResolvedValue(FLAG_ON);
    scan.mockResolvedValue({
      repoType: 'monorepo',
      projects: [
        project({ path: 'ios', framework: 'Cordova', recommended: true }),
        project({ path: 'apps/api', framework: 'Express', targetId: 'node' }),
      ],
    });
    const session = buildSession({ installDir: '/repo' });
    await scopeInstallDirToProject(session);

    expect(session.installDir).toBe('/repo/apps/api');
    expect(outcomeEvent()).toMatchObject({
      outcome: 'first-instrumentable',
      has_recommendation: true,
      recommended_path: 'ios',
      recommended_framework: null,
      chosen_path: 'apps/api',
      chosen_framework: 'node',
    });
  });

  it('leaves the session untouched and fires timeout when the scan outruns the budget', async () => {
    // The scan is abandoned, not cancelled — the run must not wait on it forever.
    vi.useFakeTimers();
    try {
      flagsSpy.mockResolvedValue(FLAG_ON);
      scan.mockReturnValue(new Promise(() => undefined));
      const session = buildSession({ installDir: '/repo' });
      const done = scopeInstallDirToProject(session);
      await vi.advanceTimersByTimeAsync(AGENTIC_DETECTION_TIMEOUT_MS);
      await done;

      expect(session.installDir).toBe('/repo');
      expect(outcomeEvent()).toMatchObject({
        outcome: 'timeout',
        duration_ms: AGENTIC_DETECTION_TIMEOUT_MS,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the session untouched and fires no-project when nothing qualifies', async () => {
    flagsSpy.mockResolvedValue(FLAG_ON);
    scan.mockResolvedValue({
      repoType: 'monorepo',
      projects: [project({ path: 'crates/core', framework: 'Rust' })],
    });
    const session = buildSession({ installDir: '/repo' });
    await scopeInstallDirToProject(session);

    expect(session.installDir).toBe('/repo');
    expect(outcomeEvent()).toMatchObject({
      outcome: 'no-project',
      project_count: 1,
      supported_count: 0,
    });
  });
});
