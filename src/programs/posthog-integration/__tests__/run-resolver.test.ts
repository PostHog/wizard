import { HostResolution } from '@shared/host-resolution';
import type { FrameworkConfig } from '@programs/framework-config';
import { requestDeepLink } from '@utils/provisioning';
import { resolvePosthogIntegrationRun } from '../run.js';

vi.mock('@utils/analytics');
vi.mock('@utils/provisioning', () => ({ requestDeepLink: vi.fn() }));

const FRAMEWORK_CONFIG = {
  metadata: { integration: 'nextjs' },
  environment: {
    uploadToHosting: true,
    getEnvVars: () => ({ NEXT_PUBLIC_POSTHOG_KEY: 'phc_test' }),
  },
  ui: { getOutroChanges: () => [] },
  detection: { usesPackageJson: false, getVersion: () => '15.0.0' },
  analytics: { getTags: () => ({}) },
  prompts: {},
} as unknown as FrameworkConfig;

describe('PostHog integration data-only run recipe', () => {
  it('preserves upload and signup deep-link effects after the agent run', async () => {
    vi.mocked(requestDeepLink).mockResolvedValue('https://us.posthog.com/home');
    const effects = {
      readPackageJson: vi.fn(),
      warn: vi.fn(),
      uploadEnvironmentVariables: vi.fn().mockResolvedValue([]),
      openDashboardDeepLink: vi.fn(),
    };
    const { hooks } = await resolvePosthogIntegrationRun(
      {
        installDir: '/tmp/app',
        frameworkConfig: FRAMEWORK_CONFIG,
        frameworkContext: {},
        typescript: false,
        warehouseSources: [],
        flags: { ci: false, signup: true, e2eAsk: false },
        wizardFlags: {},
        mayReportScanResults: false,
      },
      effects,
    );
    const credentials = {
      accessToken: 'token',
      projectApiKey: 'phc_test',
      projectId: 123,
      host: HostResolution.fromApiHost('https://us.posthog.com'),
    };

    await hooks.postRun?.(credentials);
    expect(effects.uploadEnvironmentVariables).toHaveBeenCalledWith(
      { NEXT_PUBLIC_POSTHOG_KEY: 'phc_test' },
      'nextjs',
    );
    expect(effects.openDashboardDeepLink).toHaveBeenCalledWith(
      'https://us.posthog.com/home?utm_source=wizard&utm_medium=cli&utm_content=dashboard-deeplink',
    );
    expect(hooks.buildOutroData?.(credentials)?.continueUrl).toContain(
      'dashboard-deeplink',
    );
  });
});
