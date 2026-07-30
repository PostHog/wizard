/**
 * `typescript` tagging in the core integration's run() callback.
 *
 * This runs after the 'auth' step (see steps.ts ordering), so by the time it
 * tags, `analytics.setGroups` has already been called — the tag rides on
 * every capture from here on, org key included.
 */

import { posthogIntegrationConfig } from '@lib/programs/posthog-integration/index';
import { buildSession, type WizardSession } from '@lib/wizard-session';
import { analytics } from '@utils/analytics';
import { isUsingTypeScript } from '@utils/setup-utils';

vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    capture: vi.fn(),
  },
}));

vi.mock('@utils/setup-utils', () => ({
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

async function resolveRun(session: WizardSession) {
  const { run } = posthogIntegrationConfig;
  if (typeof run !== 'function') throw new Error('expected a run function');
  return run(session);
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
});
