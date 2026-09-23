/**
 * `typescript` tagging in the core integration's run() callback.
 *
 * `run()` resolves before `runProgram()` authenticates, so this tags ahead of
 * `setGroups()`. Order doesn't matter: the tag bag is independent of group
 * state, so the value rides on every later capture either way.
 */

import { posthogIntegrationConfig } from '@programs/posthog-integration/index';
import type { ProgramRunHost } from '@programs/host-capabilities';
import { analytics } from '@utils/analytics';
import { isUsingTypeScript } from '@utils/package-json';
import { HostResolution } from '@shared/host-resolution';
import { Integration } from '@shared/constants';
import { uploadEnvironmentVariablesStep } from '@programs/posthog-integration/upload-environment-variables';
import { buildSession } from '@tui/session';
import type { WizardSession } from '@tui/session';

vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    capture: vi.fn(),
  },
}));

vi.mock('@programs/posthog-integration/upload-environment-variables', () => ({
  uploadEnvironmentVariablesStep: vi.fn().mockResolvedValue(['POSTHOG_KEY']),
}));

vi.mock('@utils/package-json', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@utils/package-json')>()),
  isUsingTypeScript: vi.fn(),
  tryGetPackageJson: vi.fn().mockResolvedValue(null),
}));

const FRAMEWORK_CONFIG = {
  metadata: { name: 'Next.js', docsUrl: 'https://posthog.com/docs' },
  environment: { getEnvVars: () => ({ POSTHOG_KEY: 'phc_test' }) },
  ui: { getOutroChanges: () => [] },
  detection: {
    usesPackageJson: false,
    getVersion: () => '15.0.0',
    packageName: 'next',
    packageDisplayName: 'Next.js',
  },
  analytics: { getTags: () => ({}) },
  prompts: { projectTypeDetection: 'app router' },
};

function sessionWithFramework(): WizardSession {
  const s = buildSession({ installDir: '/tmp/app' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s.frameworkConfig = FRAMEWORK_CONFIG as any;
  return s;
}

function runHost(): ProgramRunHost {
  return {
    getFrameworkContext: vi.fn(),
    setFrameworkContext: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    spinner: () => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() }),
  };
}

async function resolveRun(session: WizardSession, host = runHost()) {
  const { run } = posthogIntegrationConfig;
  if (typeof run !== 'function') throw new Error('expected a run function');
  return run(session, host);
}

describe('posthog-integration run() — typescript tag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tags typescript: true when a tsconfig is detected', async () => {
    (isUsingTypeScript as Mock).mockReturnValue(true);
    const session = sessionWithFramework();

    await resolveRun(session);

    expect(session.typescript).toBe(true);
    expect(analytics.setTag).toHaveBeenCalledWith('typescript', true);
  });

  it('tags typescript: false when none is detected', async () => {
    (isUsingTypeScript as Mock).mockReturnValue(false);
    const session = sessionWithFramework();

    await resolveRun(session);

    expect(session.typescript).toBe(false);
    expect(analytics.setTag).toHaveBeenCalledWith('typescript', false);
  });

  it('routes missing package warnings through the run host', async () => {
    (isUsingTypeScript as Mock).mockReturnValue(false);
    const session = sessionWithFramework();
    if (!session.frameworkConfig) throw new Error('missing framework config');
    session.frameworkConfig = {
      ...session.frameworkConfig,
      detection: {
        ...session.frameworkConfig.detection,
        usesPackageJson: true,
      },
    };
    const host = runHost();

    await resolveRun(session, host);

    expect(host.warn).toHaveBeenCalledWith(
      'Could not find package.json. Continuing anyway — the agent will handle it.',
    );
  });

  it('uploads to hosting from the program, reporting through the run host', async () => {
    (isUsingTypeScript as Mock).mockReturnValue(false);
    const session = sessionWithFramework();
    if (!session.frameworkConfig) throw new Error('missing framework config');
    session.frameworkConfig = {
      ...session.frameworkConfig,
      metadata: {
        ...session.frameworkConfig.metadata,
        integration: Integration.nextjs,
      },
      environment: {
        ...session.frameworkConfig.environment,
        uploadToHosting: true,
      },
    };
    const host = runHost();
    const run = await resolveRun(session, host);

    await run.postRun?.(
      { signup: false, dashboardUrl: null, notebookUrl: null },
      {
        accessToken: 'token',
        projectApiKey: 'phc_test',
        projectId: 123,
        host: HostResolution.fromApiHost('https://us.posthog.com'),
      },
    );

    expect(uploadEnvironmentVariablesStep).toHaveBeenCalledWith(
      { POSTHOG_KEY: 'phc_test' },
      expect.objectContaining({
        integration: Integration.nextjs,
        installDir: '/tmp/app',
      }),
    );
    const { report } = (uploadEnvironmentVariablesStep as Mock).mock
      .calls[0][1] as { report: { info(message: string): void } };
    report.info('Uploading environment variables to Vercel...');
    expect(host.info).toHaveBeenCalledWith(
      'Uploading environment variables to Vercel...',
    );
  });
});
