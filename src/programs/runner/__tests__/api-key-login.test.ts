import { apiKeyCredentials, resolveApiKeyLogin } from '../api-key-login';
import { detectRegion } from '@utils/urls';
import { fetchProjectData, fetchUserData } from '@shared/api';

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

const mockedDetect = detectRegion as unknown as ReturnType<typeof vi.fn>;
const mockedFetchProject = fetchProjectData as unknown as ReturnType<
  typeof vi.fn
>;
const mockedFetchUser = fetchUserData as unknown as ReturnType<typeof vi.fn>;

const project = {
  id: 123,
  uuid: '00000000-0000-0000-0000-000000000000',
  organization: '11111111-1111-1111-1111-111111111111',
  api_token: 'phc_test',
  name: 'Test Project',
};

describe('resolveApiKeyLogin CI region', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchProject.mockResolvedValue(project);
    mockedFetchUser.mockResolvedValue({
      distinct_id: 'user-1',
      role_at_organization: null,
    });
  });

  it('uses the provided region and never probes @me for it', async () => {
    const result = await resolveApiKeyLogin('phx_test', {
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
    expect(result.posthog.host.region).toBe('eu');
  });

  it('reports the CI login line once', async () => {
    const onInfo = vi.fn();
    await resolveApiKeyLogin('phx_test', {
      projectId: 123,
      region: 'eu',
      onInfo,
    });
    expect(onInfo).toHaveBeenCalledOnce();
  });

  it('falls back to detection only when no region is provided', async () => {
    mockedDetect.mockResolvedValue('us');

    await resolveApiKeyLogin('phx_test', { projectId: 123 });

    expect(mockedDetect).toHaveBeenCalledTimes(1);
  });
});

describe('apiKeyCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs in once, and logs in again after a failed login', async () => {
    mockedFetchUser.mockResolvedValue({
      distinct_id: 'user-1',
      role_at_organization: null,
    });
    mockedFetchProject
      .mockRejectedValueOnce(new Error('503 transient'))
      .mockResolvedValue(project);
    const provider = apiKeyCredentials('phx_test', {
      projectId: 123,
      region: 'eu',
    });
    const context = { signal: new AbortController().signal };

    await expect(provider.resolve('metrics', context)).rejects.toThrow(
      '503 transient',
    );
    const login = await provider.resolve('metrics', context);
    expect(login.posthog.projectId).toBe(123);
    await provider.resolve('metrics', context);
    expect(mockedFetchProject).toHaveBeenCalledTimes(2);
  });
});
