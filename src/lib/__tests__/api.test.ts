import { fetchProjectData, fetchUserData } from '../api';
import { WIZARD_USER_AGENT } from '../constants';

jest.mock('axios', () => {
  const get = jest.fn();
  const isAxiosError = jest.fn((error: unknown) => {
    return (
      typeof error === 'object' &&
      error !== null &&
      'isAxiosError' in error &&
      Boolean((error as { isAxiosError?: unknown }).isAxiosError)
    );
  });

  return {
    __esModule: true,
    default: { get },
    isAxiosError,
  };
});

jest.mock('../../utils/analytics', () => ({
  analytics: {
    captureException: jest.fn(),
  },
}));

const axiosMock = jest.requireMock('axios');

describe('api', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetchProjectData accepts project payloads with only the fields the wizard uses', async () => {
    axiosMock.default.get.mockResolvedValue({
      data: {
        id: 123,
        api_token: 'phc_test_token',
        organization: { id: 'not-a-uuid-anymore' },
        name: null,
      },
    });

    await expect(
      fetchProjectData('oauth-token', 123, 'https://eu.posthog.com'),
    ).resolves.toEqual({
      id: 123,
      api_token: 'phc_test_token',
    });

    expect(axiosMock.default.get).toHaveBeenCalledWith(
      'https://eu.posthog.com/api/projects/123/',
      {
        headers: {
          Authorization: 'Bearer oauth-token',
          'User-Agent': WIZARD_USER_AGENT,
        },
      },
    );
  });

  it('fetchUserData accepts user payloads without organization metadata', async () => {
    axiosMock.default.get.mockResolvedValue({
      data: {
        distinct_id: 'user_123',
        team: { id: 456 },
      },
    });

    await expect(
      fetchUserData('oauth-token', 'https://us.posthog.com'),
    ).resolves.toEqual({
      distinct_id: 'user_123',
      team: { id: 456 },
    });

    expect(axiosMock.default.get).toHaveBeenCalledWith(
      'https://us.posthog.com/api/users/@me/',
      {
        headers: {
          Authorization: 'Bearer oauth-token',
          'User-Agent': WIZARD_USER_AGENT,
        },
      },
    );
  });
});
