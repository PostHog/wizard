import { getOrAskForProjectData } from '@tui/auth/project-data';
import { detectRegion } from '@utils/urls';
import { fetchProjectData, fetchUserData } from '@shared/api';
import { performOAuthFlow } from '../oauth';
import { provisionNewAccount } from '@utils/provisioning';
import type { WizardStore } from '@tui/store';
import { WIZARD_OAUTH_SCOPES } from '@shared/constants';
import { CONNECT_SLACK_SCOPE_ADDITIONS } from '@shared/oauth-scopes';

vi.mock('@utils/urls', () => ({
  detectRegion: vi.fn(),
  getHost: (r: string) => `https://${r}.posthog.com`,
  getCloudUrl: (r: string) => `https://${r}.posthog.com`,
  getUiHostFromHost: (host: string) => host,
  resolveBaseUrl: (baseUrl?: string) => baseUrl,
}));
vi.mock('@shared/api', () => ({
  fetchProjectData: vi.fn(),
  fetchUserData: vi.fn(),
}));
vi.mock('@utils/analytics', () => ({
  analytics: {
    identifyUser: vi.fn(),
    captureException: vi.fn(),
    setTag: vi.fn(),
  },
}));
vi.mock(import('../oauth'), () => ({
  performOAuthFlow: vi.fn(),
  assertWizardCompletionScope: vi.fn(),
  missingOAuthScopes: vi.fn(() => []),
}));
vi.mock(import('@utils/provisioning'), async (importOriginal) => ({
  ...(await importOriginal()),
  provisionNewAccount: vi.fn(),
}));

const mockedDetect = detectRegion as unknown as ReturnType<typeof vi.fn>;
const mockedFetchProject = fetchProjectData as unknown as ReturnType<
  typeof vi.fn
>;
const mockedFetchUser = fetchUserData as unknown as ReturnType<typeof vi.fn>;
const mockedOAuthFlow = performOAuthFlow as unknown as ReturnType<typeof vi.fn>;

const store = { pushStatus: vi.fn() } as unknown as WizardStore;

const project = {
  id: 123,
  uuid: '00000000-0000-0000-0000-000000000000',
  organization: '11111111-1111-1111-1111-111111111111',
  api_token: 'phc_test',
  name: 'Test Project',
};

describe('getOrAskForProjectData OAuth login region', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchProject.mockResolvedValue(project);
    mockedFetchUser.mockResolvedValue({
      distinct_id: 'user-1',
      role_at_organization: null,
    });
  });

  it('uses posthog_region from the token response and never probes @me', async () => {
    mockedOAuthFlow.mockResolvedValue({
      access_token: 'pha_test',
      scope: 'event_definition:write',
      scoped_teams: [123],
      posthog_region: 'eu',
    });

    const result = await getOrAskForProjectData({
      store,
      signup: false,
      projectId: 123,
    });

    expect(mockedDetect).not.toHaveBeenCalled();
    expect(mockedFetchProject).toHaveBeenCalledWith(
      'pha_test',
      123,
      'https://eu.posthog.com',
    );
    expect(result.host.region).toBe('eu');
  });

  it('falls back to detection when the token response has no region', async () => {
    mockedOAuthFlow.mockResolvedValue({
      access_token: 'pha_test',
      scope: 'event_definition:write',
      scoped_teams: [123],
    });
    mockedDetect.mockResolvedValue('eu');

    await getOrAskForProjectData({
      store,
      signup: false,
      projectId: 123,
    });

    expect(mockedDetect).toHaveBeenCalledTimes(1);
    expect(mockedFetchProject).toHaveBeenCalledWith(
      'pha_test',
      123,
      'https://eu.posthog.com',
    );
  });
});

describe('getOrAskForProjectData OAuth scopes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchProject.mockResolvedValue(project);
    mockedFetchUser.mockResolvedValue({
      distinct_id: 'user-1',
      role_at_organization: null,
    });
    mockedOAuthFlow.mockResolvedValue({
      access_token: 'pha_test',
      scope: 'event_definition:write',
      scoped_teams: [123],
      posthog_region: 'us',
    });
  });

  // The Connect Slack screen's poll 403s without its `integration:read`.
  it("asks for the base set widened by the login's scope additions", async () => {
    await getOrAskForProjectData({
      store,
      signup: false,
      projectId: 123,
      scopeAdditions: CONNECT_SLACK_SCOPE_ADDITIONS,
    });

    const [{ scopes }] = mockedOAuthFlow.mock.calls[0] as [
      { scopes: string[] },
    ];
    expect(scopes).toEqual([...WIZARD_OAUTH_SCOPES, 'integration:read']);
  });
});

describe('getOrAskForProjectData signup fallback', () => {
  // An existing account falls back to login, which must keep the run's scopes and project.
  it('logs in with the scope additions and project id when the email already has an account', async () => {
    vi.clearAllMocks();
    vi.mocked(provisionNewAccount).mockRejectedValue(
      new Error('Email is already associated with an account'),
    );
    mockedFetchProject.mockResolvedValue(project);
    mockedFetchUser.mockResolvedValue({
      distinct_id: 'user-1',
      role_at_organization: null,
    });
    mockedOAuthFlow.mockResolvedValue({
      access_token: 'pha_test',
      scope: 'event_definition:write',
      scoped_teams: [123],
      posthog_region: 'us',
    });

    await getOrAskForProjectData({
      store,
      signup: true,
      email: 'dev@example.com',
      projectId: 123,
      scopeAdditions: CONNECT_SLACK_SCOPE_ADDITIONS,
    });

    expect(mockedOAuthFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: [...WIZARD_OAUTH_SCOPES, 'integration:read'],
        projectId: 123,
      }),
      store,
    );
  });
});
