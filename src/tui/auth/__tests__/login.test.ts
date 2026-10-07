vi.mock(import('@utils/analytics'), () => ({
  analytics: { wizardCapture: vi.fn() } as never,
}));
vi.mock(import('@utils/debug'));
vi.mock(import('../project-data'), () => ({ getOrAskForProjectData: vi.fn() }));

import { HostResolution } from '@shared/host-resolution';
import { analytics } from '@utils/analytics';
import { buildSession } from '@programs';
import type { WizardStore } from '@tui/store';
import { oauthLogin } from '../login';
import { getOrAskForProjectData } from '../project-data';

it('reports auth complete for the OAuth login and returns it for the store', async () => {
  vi.mocked(getOrAskForProjectData).mockResolvedValue({
    host: HostResolution.fromRegion('us'),
    projectApiKey: 'phc_test',
    accessToken: 'pha_test',
    refreshToken: 'phr_test',
    expiresAt: 1,
    projectId: 42,
    roleAtOrganization: 'founder',
    user: null,
    project: null,
    missingScopes: [],
  });
  const login = await oauthLogin(
    buildSession({ installDir: '/project' }),
    'metrics',
    {} as WizardStore,
  );
  expect(analytics.wizardCapture).toHaveBeenCalledWith('auth complete', {
    project_id: 42,
  });
  expect(login).toMatchObject({
    posthog: {
      accessToken: 'pha_test',
      refreshToken: 'phr_test',
      projectId: 42,
    },
    roleAtOrganization: 'founder',
  });
});
