import { getOrAskForProjectData } from '@utils/setup-utils';
import { detectRegion } from '@utils/urls';
import { fetchProjectData, fetchUserData } from '@lib/api';
import { performOAuthFlow } from '@utils/oauth';

vi.mock('@ui', () => ({
  getUI: () => ({
    log: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warn: vi.fn() },
  }),
}));
vi.mock('@utils/urls', () => ({
  detectRegion: vi.fn(),
  getHost: (r: string) => `https://${r}.posthog.com`,
  getCloudUrl: (r: string) => `https://${r}.posthog.com`,
  getLlmGatewayUrl: (host: string) => `${host}/llm-gateway`,
  getUiHostFromHost: (host: string) => host,
  resolveBaseUrl: (baseUrl?: string) => baseUrl,
}));
vi.mock('@lib/api', () => ({
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
vi.mock('@utils/oauth', () => ({
  performOAuthFlow: vi.fn(),
  assertWizardCompletionScope: vi.fn(),
}));

const mockedDetect = detectRegion as unknown as ReturnType<typeof vi.fn>;
const mockedFetchProject = fetchProjectData as unknown as ReturnType<
  typeof vi.fn
>;
const mockedFetchUser = fetchUserData as unknown as ReturnType<typeof vi.fn>;
const mockedOAuthFlow = performOAuthFlow as unknown as ReturnType<typeof vi.fn>;

const project = {
  id: 123,
  uuid: '00000000-0000-0000-0000-000000000000',
  organization: '11111111-1111-1111-1111-111111111111',
  api_token: 'phc_test',
  name: 'Test Project',
};

describe('getOrAskForProjectData CI region', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchProject.mockResolvedValue(project);
  });

  it('uses the provided region and never probes @me for it', async () => {
    const result = await getOrAskForProjectData({
      ci: true,
      apiKey: 'phx_test',
      projectId: 123,
      region: 'eu',
    });

    // The flaky region probe must not run when the region was handed in.
    expect(mockedDetect).not.toHaveBeenCalled();
    // And the project is fetched from the given region's cloud.
    expect(mockedFetchProject).toHaveBeenCalledWith(
      'phx_test',
      123,
      'https://eu.posthog.com',
    );
    expect(result.host.region).toBe('eu');
  });

  it('falls back to detection only when no region is provided', async () => {
    mockedDetect.mockResolvedValue('us');

    await getOrAskForProjectData({
      ci: true,
      apiKey: 'phx_test',
      projectId: 123,
    });

    expect(mockedDetect).toHaveBeenCalledTimes(1);
  });
});

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
      ci: false,
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

    await getOrAskForProjectData({ ci: false, signup: false, projectId: 123 });

    expect(mockedDetect).toHaveBeenCalledTimes(1);
    expect(mockedFetchProject).toHaveBeenCalledWith(
      'pha_test',
      123,
      'https://eu.posthog.com',
    );
  });
});
