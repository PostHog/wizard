import { getOrAskForProjectData } from '@tui/auth/project-data';
import { detectRegion } from '@utils/urls';
import { fetchProjectData, fetchUserData } from '@shared/api';
import { performOAuthFlow } from '../oauth';
import type { WizardStore } from '@tui/store';
import { WIZARD_OAUTH_SCOPES } from '@shared/constants';
import { getOAuthScopesForProgram } from '@programs';
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
      projectId: 123,
      scopeAdditions: CONNECT_SLACK_SCOPE_ADDITIONS,
    });

    const [{ scopes }] = mockedOAuthFlow.mock.calls[0] as [
      { scopes: string[] },
    ];
    expect(scopes).toEqual([...WIZARD_OAUTH_SCOPES, 'integration:read']);
  });
});

describe('getOrAskForProjectData sign-up', () => {
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

  // Sign-up is the browser login started on the sign-up page, so it keeps the program's scopes and project.
  it("opens the sign-up page with the program's login scopes", async () => {
    const result = await getOrAskForProjectData({
      store,
      signup: true,
      projectId: 123,
      programId: 'self-driving',
    });

    expect(mockedOAuthFlow).toHaveBeenCalledWith(
      {
        scopes: [...getOAuthScopesForProgram('self-driving')],
        signup: true,
        projectId: 123,
        baseUrl: undefined,
      },
      store,
    );
    expect(result.projectApiKey).toBe('phc_test');
  });

  it('opens the login page when the run does not sign up', async () => {
    await getOrAskForProjectData({ store, projectId: 123 });

    expect(mockedOAuthFlow).toHaveBeenCalledWith(
      expect.objectContaining({ signup: undefined }),
      store,
    );
  });
});
