import { HostResolution } from '@shared/host-resolution';
import type { FrameworkConfig } from '@programs/framework-config';
import {
  resolvePosthogIntegrationRun,
  resolvePosthogIntegrationSeedTasks,
  type PosthogIntegrationRunEffects,
} from '../run.js';

const FRAMEWORK_CONFIG = {
  metadata: {
    name: 'Next.js',
    integration: 'nextjs',
    docsUrl: 'https://posthog.com/docs/libraries/next-js',
  },
  environment: {
    uploadToHosting: true,
    getEnvVars: () => ({ NEXT_PUBLIC_POSTHOG_KEY: 'phc_test' }),
  },
  ui: {
    successMessage: 'Done',
    estimatedDurationMinutes: 5,
    getOutroChanges: () => ['Configured Next.js'],
  },
  detection: {
    usesPackageJson: false,
    getVersion: () => '15.0.0',
    getVersionBucket: () => '15.x',
  },
  analytics: { getTags: () => ({ router: 'app' }) },
  prompts: { projectTypeDetection: 'app router' },
} as unknown as FrameworkConfig;

const WAREHOUSE_SOURCE = {
  kind: 'Postgres',
  label: 'PostgreSQL',
  mode: 'in-cli' as const,
  matchedSignal: 'dependency: pg',
};

function effects(): PosthogIntegrationRunEffects {
  return {
    readPackageJson: vi.fn().mockResolvedValue(null),
    hasDeclaredDependency: vi.fn().mockReturnValue(true),
    warn: vi.fn(),
    setTag: vi.fn(),
    capture: vi.fn(),
    uploadEnvironmentVariables: vi
      .fn()
      .mockResolvedValue(['NEXT_PUBLIC_POSTHOG_KEY']),
    requestDeepLink: vi.fn().mockResolvedValue('https://us.posthog.com/home'),
    openDashboardDeepLink: vi.fn(),
    getNotebookUrl: vi.fn().mockReturnValue('https://us.posthog.com/notebook'),
  };
}

describe('PostHog integration data-only run recipe', () => {
  it('does not queue a credential prompt in unattended runs', () => {
    const capture = vi.fn();
    const tasks = resolvePosthogIntegrationSeedTasks(
      {
        warehouseSources: [WAREHOUSE_SOURCE],
        flags: { ci: true, signup: false, e2eAsk: false },
        mayReportScanResults: true,
      },
      capture,
    );
    expect(tasks).toEqual([]);
    expect(capture).not.toHaveBeenCalled();
  });

  it('builds prompt, seeded warehouse task, and outro from explicit inputs', async () => {
    const fx = effects();
    const { run, hooks, seedTasks } = await resolvePosthogIntegrationRun(
      {
        installDir: '/tmp/app',
        frameworkConfig: FRAMEWORK_CONFIG,
        frameworkContext: {},
        typescript: true,
        warehouseSources: [WAREHOUSE_SOURCE],
        flags: { ci: false, signup: false, e2eAsk: false },
        mayReportScanResults: true,
      },
      fx,
    );
    const host = HostResolution.fromApiHost('https://us.posthog.com');
    const credentials = {
      accessToken: 'token',
      projectApiKey: 'phc_test',
      projectId: 123,
      host,
    };

    expect(fx.setTag).toHaveBeenCalledWith('typescript', true);
    expect(fx.setTag).toHaveBeenCalledWith('router', 'app');
    expect(run.customPrompt?.(credentials)).toContain('PostgreSQL');
    expect(seedTasks).toHaveLength(1);
    expect(seedTasks[0]?.type).toBe('warehouse');
    expect(fx.capture).toHaveBeenCalledWith(
      'orchestrator warehouse task queued',
      expect.objectContaining({ warehouse_source_count: 1 }),
    );
    expect(hooks.buildOutroNextSteps?.(credentials, [])?.items[0]).toContain(
      'kind=Postgres',
    );
    expect(
      hooks.buildOutroNextSteps?.(credentials, ['warehouse']),
    ).toBeUndefined();
    expect(hooks.buildOutroData?.(credentials)?.notebookUrl).toBe(
      'https://us.posthog.com/notebook',
    );
  });

  it('preserves upload and signup deep-link effects after the agent run', async () => {
    const fx = effects();
    const { hooks } = await resolvePosthogIntegrationRun(
      {
        installDir: '/tmp/app',
        frameworkConfig: FRAMEWORK_CONFIG,
        frameworkContext: {},
        typescript: false,
        warehouseSources: [],
        flags: { ci: false, signup: true, e2eAsk: false },
        mayReportScanResults: false,
      },
      fx,
    );
    const credentials = {
      accessToken: 'token',
      projectApiKey: 'phc_test',
      projectId: 123,
      host: HostResolution.fromApiHost('https://us.posthog.com'),
    };

    await hooks.postRun?.(credentials);
    expect(fx.uploadEnvironmentVariables).toHaveBeenCalledWith(
      { NEXT_PUBLIC_POSTHOG_KEY: 'phc_test' },
      'nextjs',
    );
    expect(fx.openDashboardDeepLink).toHaveBeenCalledWith(
      'https://us.posthog.com/home?utm_source=wizard&utm_medium=cli&utm_content=dashboard-deeplink',
    );
    expect(hooks.buildOutroData?.(credentials)?.continueUrl).toContain(
      'dashboard-deeplink',
    );
  });
});
