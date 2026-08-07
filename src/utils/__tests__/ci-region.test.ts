import { getOrAskForProjectData } from '@utils/setup-utils';
import { detectRegion } from '@utils/urls';
import { fetchProjectData, fetchUserData } from '@lib/api';
import { performOAuthFlow } from '@utils/oauth';
import { analytics } from '@utils/analytics';

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
vi.mock('@utils/oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@utils/oauth')>()),
  // Only the network-driven flow is stubbed; the completion-scope helper stays
  // real so the login path's degrade/retry branch is exercised, not faked.
  performOAuthFlow: vi.fn(),
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

describe('getOrAskForProjectData missing completion scope', () => {
  const mockedCapture = analytics.captureException as unknown as ReturnType<
    typeof vi.fn
  >;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchProject.mockResolvedValue(project);
    mockedFetchUser.mockResolvedValue({
      distinct_id: 'user-1',
      role_at_organization: null,
    });
  });

  it('re-requests consent when a reused grant lacks the completion scope', async () => {
    // First login reuses the pre-existing grant and skips consent, so the token
    // comes back without event_definition:write; the forced-consent retry then
    // returns the widened grant.
    mockedOAuthFlow
      .mockResolvedValueOnce({
        access_token: 'pha_test',
        scope: 'user:read wizard_session:write',
        scoped_teams: [123],
        posthog_region: 'us',
      })
      .mockResolvedValueOnce({
        access_token: 'pha_test',
        scope: 'user:read wizard_session:write event_definition:write',
        scoped_teams: [123],
        posthog_region: 'us',
      });

    await getOrAskForProjectData({ ci: false, signup: false, projectId: 123 });

    expect(mockedOAuthFlow).toHaveBeenCalledTimes(2);
    expect(mockedOAuthFlow.mock.calls[1][0]).toMatchObject({
      promptConsent: true,
    });
    // Consent widened the grant, so nothing is captured as degraded.
    expect(mockedCapture).not.toHaveBeenCalled();
  });

  it('degrades instead of aborting when consent still cannot widen the grant', async () => {
    // The OAuth server ignored prompt=consent (or the user declined), so both
    // attempts return the narrow scope set.
    mockedOAuthFlow.mockResolvedValue({
      access_token: 'pha_test',
      scope: 'user:read wizard_session:write',
      scoped_teams: [123],
      posthog_region: 'us',
    });

    const result = await getOrAskForProjectData({
      ci: false,
      signup: false,
      projectId: 123,
    });

    expect(mockedOAuthFlow).toHaveBeenCalledTimes(2);
    // Run continues (no abort) and returns a usable project.
    expect(result.projectId).toBe(123);
    // The degraded run is captured once with a stable fingerprint so error
    // tracking collapses it into a single issue.
    expect(mockedCapture).toHaveBeenCalledTimes(1);
    expect(mockedCapture.mock.calls[0][1]).toMatchObject({
      step: 'wizard_login',
      missing_scope: 'event_definition:write',
      $exception_fingerprint: 'wizard_oauth_missing_completion_scope',
    });
  });
});
