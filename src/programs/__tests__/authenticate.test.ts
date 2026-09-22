import { authenticate, type AuthSession } from '../authenticate';
import { getOrAskForProjectData } from '@utils/setup-utils';
import { HostResolution } from '@shared/host-resolution';
import type { ApiUser } from '@shared/api';

vi.mock('@utils/setup-utils', () => ({ getOrAskForProjectData: vi.fn() }));
vi.mock('@utils/debug', () => ({ logToFile: vi.fn() }));
vi.mock('@utils/analytics', () => ({
  analytics: { identifyUser: vi.fn(), setGroups: vi.fn() },
  groupsFromUser: vi.fn().mockReturnValue({}),
}));
vi.mock('@ui', () => ({
  getUI: () => {
    throw new Error('authentication must use the supplied projection');
  },
}));

it('publishes the first login through its projection and reuses it', async () => {
  const user = { distinct_id: 'user-1' } as ApiUser;
  vi.mocked(getOrAskForProjectData).mockResolvedValue({
    accessToken: 'pha_test',
    projectApiKey: 'phc_test',
    host: HostResolution.fromApiHost('https://us.posthog.com'),
    projectId: 42,
    roleAtOrganization: 'admin',
    user,
    project: null,
    missingScopes: [],
  });
  const session: AuthSession = {
    credentials: null,
    ci: false,
    signup: false,
    localMcp: false,
    apiProject: null,
    roleAtOrganization: null,
    apiUser: null,
  };
  const projection = {
    setCredentials: vi.fn(),
    setRoleAtOrganization: vi.fn(),
    setApiUser: vi.fn(),
  };

  await authenticate(session, 'metrics', projection);
  await authenticate(session, 'metrics', projection);

  expect(getOrAskForProjectData).toHaveBeenCalledOnce();
  expect(projection.setCredentials).toHaveBeenCalledExactlyOnceWith(
    session.credentials,
  );
  expect(projection.setRoleAtOrganization).toHaveBeenCalledExactlyOnceWith(
    'admin',
  );
  expect(projection.setApiUser).toHaveBeenCalledExactlyOnceWith(user);
});
