import axios from 'axios';
import { ApiError, fetchProjectData, fetchUserData } from '@lib/api';

jest.mock('axios');
jest.mock('@utils/analytics', () => ({
  analytics: {
    captureException: jest.fn(),
  },
}));
// Avoid real backoff delays in tests.
jest.mock('@lib/helper-functions', () => ({
  sleep: jest.fn(() => Promise.resolve()),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
// fetchUserData/fetchProjectData call the module-level `axios.get`, and the
// retry logic relies on `axios.isAxiosError`. Restore the real type guard.
(mockedAxios.isAxiosError as unknown as jest.Mock).mockImplementation(
  jest.requireActual('axios').isAxiosError,
);

function axiosErrorWithStatus(status: number): Error {
  const err = new Error(
    `Request failed with status code ${status}`,
  ) as Error & {
    isAxiosError: boolean;
    response: { status: number; data: unknown };
    config: { url: string };
  };
  err.isAxiosError = true;
  err.response = { status, data: {} };
  err.config = { url: '/api/projects/2/' };
  return err;
}

function networkError(): Error {
  const err = new Error('ECONNRESET') as Error & {
    isAxiosError: boolean;
    config: { url: string };
  };
  err.isAxiosError = true;
  // No `response` field -> network/timeout failure.
  err.config = { url: '/api/projects/2/' };
  return err;
}

const VALID_PROJECT = {
  id: 2,
  uuid: '00000000-0000-0000-0000-000000000000',
  organization: '11111111-1111-1111-1111-111111111111',
  api_token: 'phc_test',
  name: 'Test project',
};

const VALID_USER = {
  distinct_id: 'user-1',
  organizations: [{ id: '11111111-1111-1111-1111-111111111111' }],
  team: { id: 2, organization: '11111111-1111-1111-1111-111111111111' },
  organization: { id: '11111111-1111-1111-1111-111111111111' },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('fetchProjectData retry behaviour', () => {
  it('retries on a 5xx and succeeds on a later attempt', async () => {
    mockedAxios.get
      .mockRejectedValueOnce(axiosErrorWithStatus(503))
      .mockResolvedValueOnce({ data: VALID_PROJECT });

    const result = await fetchProjectData('token', 2, 'https://us.posthog.com');

    expect(result.api_token).toBe('phc_test');
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it('retries on a network error and succeeds on a later attempt', async () => {
    mockedAxios.get
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce({ data: VALID_PROJECT });

    const result = await fetchProjectData('token', 2, 'https://us.posthog.com');

    expect(result.api_token).toBe('phc_test');
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it('gives up after the maximum number of attempts on persistent 5xx', async () => {
    mockedAxios.get.mockRejectedValue(axiosErrorWithStatus(500));

    await expect(
      fetchProjectData('token', 2, 'https://us.posthog.com'),
    ).rejects.toBeInstanceOf(ApiError);

    expect(mockedAxios.get).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 404 (definite failure)', async () => {
    mockedAxios.get.mockRejectedValue(axiosErrorWithStatus(404));

    await expect(
      fetchProjectData('token', 2, 'https://us.posthog.com'),
    ).rejects.toBeInstanceOf(ApiError);

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 401 (auth failure)', async () => {
    mockedAxios.get.mockRejectedValue(axiosErrorWithStatus(401));

    await expect(
      fetchProjectData('token', 2, 'https://us.posthog.com'),
    ).rejects.toBeInstanceOf(ApiError);

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });
});

describe('fetchUserData retry behaviour', () => {
  it('retries on a 5xx and succeeds on a later attempt', async () => {
    mockedAxios.get
      .mockRejectedValueOnce(axiosErrorWithStatus(502))
      .mockResolvedValueOnce({ data: VALID_USER });

    const result = await fetchUserData('token', 'https://us.posthog.com');

    expect(result.distinct_id).toBe('user-1');
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 403 (definite failure)', async () => {
    mockedAxios.get.mockRejectedValue(axiosErrorWithStatus(403));

    await expect(
      fetchUserData('token', 'https://us.posthog.com'),
    ).rejects.toBeInstanceOf(ApiError);

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });
});
