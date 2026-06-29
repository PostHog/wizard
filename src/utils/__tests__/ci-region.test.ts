import { getOrAskForProjectData } from '@utils/setup-utils';
import { detectRegionFromToken } from '@utils/urls';
import { fetchProjectData } from '@lib/api';

vi.mock('@ui', () => ({
  getUI: () => ({
    log: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
  }),
}));
vi.mock('@utils/urls', () => ({
  detectRegionFromToken: vi.fn(),
  getHostFromRegion: (r: string) => `https://${r}.posthog.com`,
  getCloudUrlFromRegion: (r: string) => `https://${r}.posthog.com`,
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

const mockedDetect = detectRegionFromToken as unknown as ReturnType<
  typeof vi.fn
>;
const mockedFetchProject = fetchProjectData as unknown as ReturnType<
  typeof vi.fn
>;

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
    expect(result.cloudRegion).toBe('eu');
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
