import { beforeEach, describe, expect, test, vi } from 'vitest';

import { Integration } from '@shared/constants';
import { detectFramework } from '@programs/detection/framework';
import { gatherFrameworkContext } from '@programs/detection/context';
import { config as featureFlagsConfig } from '@programs/feature-flags';
import type { WizardSession } from '@programs/session/wizard-session';
import { testCiRunnerContext } from '@programs/shared/__tests__/runner-context.no-jest';
import { analytics } from '@utils/analytics';

vi.mock(import('@programs/detection/framework'), async (importOriginal) => ({
  ...(await importOriginal()),
  detectFramework: vi.fn(),
}));
vi.mock(import('@programs/detection/context'), async (importOriginal) => ({
  ...(await importOriginal()),
  gatherFrameworkContext: vi.fn(),
}));
vi.mock('@programs/detection/project-scope', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@programs/detection/project-scope')
  >()),
  scopeInstallDirToProject: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(analytics, 'setTag').mockImplementation(() => undefined);
});

describe('feature-flags program', () => {
  test('headless pre-run sets the skill id to the detected framework', async () => {
    vi.mocked(detectFramework).mockResolvedValue(Integration.nextjs);
    vi.mocked(gatherFrameworkContext).mockResolvedValue({});
    const session = {
      installDir: '/tmp/feature-flags-ci',
      frameworkContext: {},
      integration: null,
      skillId: null,
    } as unknown as WizardSession;

    await featureFlagsConfig.ciPreRun?.(session, testCiRunnerContext());

    expect(session.integration).toBe(Integration.nextjs);
    expect(session.skillId).toBe(Integration.nextjs);
  });
});
