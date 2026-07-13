import {
  detectProjectsWithAgent,
  type AgenticProject,
} from '@lib/detection/agentic';
import {
  chooseIntegrationProject,
  scopeInstallDirToProject,
} from '@lib/detection/project-scope';
import {
  BASIC_INTEGRATION_AGENTIC_DETECTION_FLAG_KEY,
  WIZARD_ORCHESTRATOR_FLAG_KEY,
  isGatewayForwardedFlag,
} from '@lib/constants';
import { authenticate } from '@lib/agent/runner/shared/authenticate';
import { buildSession } from '@lib/wizard-session';
import { analytics } from '@utils/analytics';

// The two network edges of scopeInstallDirToProject. Everything else
// (chooseIntegrationProject, resolveProjectDir, the session) runs real.
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
    // The main app wins over a PostHog-free secondary project: skipping it
    // would silently instrument an API service or docs site instead, and the
    // integration handles existing installs.
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
  const FLAG_ON = { [BASIC_INTEGRATION_AGENTIC_DETECTION_FLAG_KEY]: 'true' };
  const web = project({
    path: 'apps/web',
    framework: 'Next.js',
    targetId: 'nextjs',
    recommended: true,
  });

  let flagsSpy: ReturnType<typeof vi.spyOn>;
  let tagSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    flagsSpy = vi
      .spyOn(analytics, 'getAllFlagsForWizard')
      .mockResolvedValue({});
    tagSpy = vi.spyOn(analytics, 'setTag').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tags flag-off and never scans when the flag is off (or the fetch failed)', async () => {
    // A failed flag fetch surfaces as an empty map, so this path also covers
    // "flags unavailable" — without the tag, rollout percentages would read
    // low with no way to tell why.
    const session = buildSession({ installDir: '/repo' });
    await scopeInstallDirToProject(session);

    expect(vi.mocked(authenticate)).toHaveBeenCalledTimes(1);
    expect(session.installDir).toBe('/repo');
    expect(tagSpy).toHaveBeenCalledWith('agentic_detection', 'flag-off');
    expect(scan).not.toHaveBeenCalled();
  });

  it('re-points installDir at the recommended project and tags recommended', async () => {
    flagsSpy.mockResolvedValue(FLAG_ON);
    scan.mockResolvedValue({ repoType: 'monorepo', projects: [web] });
    const session = buildSession({ installDir: '/repo' });
    await scopeInstallDirToProject(session);

    expect(session.installDir).toBe('/repo/apps/web');
    expect(tagSpy).toHaveBeenCalledWith('agentic_detection', 'recommended');
  });

  it('tags first-instrumentable when the fallback pick wins', async () => {
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
    expect(tagSpy).toHaveBeenCalledWith(
      'agentic_detection',
      'first-instrumentable',
    );
  });

  it('leaves the session untouched and tags error-fallback when the scan throws', async () => {
    flagsSpy.mockResolvedValue(FLAG_ON);
    scan.mockRejectedValue(new Error('agent unavailable'));
    const session = buildSession({ installDir: '/repo' });
    await scopeInstallDirToProject(session);

    expect(session.installDir).toBe('/repo');
    expect(tagSpy).toHaveBeenCalledWith('agentic_detection', 'error-fallback');
  });

  it('leaves the session untouched and tags none-fallback when nothing qualifies', async () => {
    flagsSpy.mockResolvedValue(FLAG_ON);
    scan.mockResolvedValue({
      repoType: 'monorepo',
      projects: [project({ path: 'crates/core', framework: 'Rust' })],
    });
    const session = buildSession({ installDir: '/repo' });
    await scopeInstallDirToProject(session);

    expect(session.installDir).toBe('/repo');
    expect(tagSpy).toHaveBeenCalledWith('agentic_detection', 'none-fallback');
  });
});

describe('isGatewayForwardedFlag', () => {
  it('forwards wizard-prefixed flags but skips wizard-local ones by name, not prefix', () => {
    // The skip must survive a rename of the flag to match its wizard-*
    // siblings — that's the whole point of the explicit list.
    expect(isGatewayForwardedFlag(WIZARD_ORCHESTRATOR_FLAG_KEY)).toBe(true);
    expect(
      isGatewayForwardedFlag(BASIC_INTEGRATION_AGENTIC_DETECTION_FLAG_KEY),
    ).toBe(false);
    expect(isGatewayForwardedFlag('unrelated-flag')).toBe(false);
  });
});
