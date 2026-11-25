vi.mock(import('@utils/analytics'), () => ({
  analytics: { wizardCapture: vi.fn() } as never,
}));
vi.mock(import('@utils/debug'));
vi.mock(import('../project-data'), () => ({ getOrAskForProjectData: vi.fn() }));
vi.mock(import('@tui/abort'), () => ({
  abortOnScreens: vi.fn(() => Promise.reject(new Error('aborted'))),
}));

import { HostResolution } from '@shared/host-resolution';
import { analytics } from '@utils/analytics';
import { buildSession } from '@programs';
import type { WizardStore } from '@tui/store';
import { oauthCredentials, oauthLogin } from '../login';
import { getOrAskForProjectData } from '../project-data';
import { abortOnScreens } from '@tui/abort';
import { ErrorCodes, WizardError } from '@shared/errors';

const projectData = {
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
};

it('reports auth complete for the OAuth login and returns it for the store', async () => {
  vi.mocked(getOrAskForProjectData).mockResolvedValue(projectData);
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

it("passes the program's completion-scope opt-out to the login", async () => {
  vi.mocked(getOrAskForProjectData).mockResolvedValue(projectData);
  const store = {
    session: buildSession({ installDir: '/project' }),
  } as WizardStore;
  await oauthCredentials(store).resolve('audit', {
    signal: new AbortController().signal,
    completionScopeOptional: true,
  });
  expect(getOrAskForProjectData).toHaveBeenCalledWith(
    expect.objectContaining({
      programId: 'audit',
      completionScopeOptional: true,
    }),
  );
});

it('ends the run on a failed project fetch, and passes any other login error through', async () => {
  const store = {} as WizardStore;
  const session = buildSession({ installDir: '/project' });
  const fetchFailed = new WizardError(
    'could not load project',
    undefined,
    ErrorCodes.AuthProjectFetchFailed,
  );
  vi.mocked(getOrAskForProjectData).mockRejectedValueOnce(fetchFailed);
  await expect(oauthLogin(session, 'metrics', store)).rejects.toThrow(
    'aborted',
  );
  expect(abortOnScreens).toHaveBeenCalledWith(store, {
    code: ErrorCodes.AuthProjectFetchFailed,
    message: 'could not load project',
    error: fetchFailed,
  });

  vi.mocked(abortOnScreens).mockClear();
  vi.mocked(getOrAskForProjectData).mockRejectedValueOnce(new Error('other'));
  await expect(oauthLogin(session, 'metrics', store)).rejects.toThrow('other');
  expect(abortOnScreens).not.toHaveBeenCalled();
});
