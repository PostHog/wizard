import axios, { AxiosError, AxiosHeaders } from 'axios';
import { fetchUserData } from '@shared/api';
import { analytics } from '@utils/analytics';

vi.mock('@utils/analytics', () => ({
  analytics: { captureException: vi.fn() },
}));

const captureException = analytics.captureException as unknown as ReturnType<
  typeof vi.fn
>;

function rejectWithStatus(status: number) {
  const config = { headers: new AxiosHeaders() };
  vi.spyOn(axios, 'get').mockRejectedValue(
    new AxiosError('failed', undefined, config, undefined, {
      status,
      statusText: '',
      headers: {},
      config,
      data: {},
    }),
  );
}

describe('fetchUserData error reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports auth failures by default', async () => {
    rejectWithStatus(403);
    await expect(
      fetchUserData('phx', 'https://us.posthog.com'),
    ).rejects.toThrow();
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('skips auth failures when reportAuthErrors is false', async () => {
    rejectWithStatus(401);
    await expect(
      fetchUserData('phx', 'https://us.posthog.com', {
        reportAuthErrors: false,
      }),
    ).rejects.toThrow('Authentication failed');
    expect(captureException).not.toHaveBeenCalled();
  });

  it('still reports other failures when reportAuthErrors is false', async () => {
    rejectWithStatus(500);
    await expect(
      fetchUserData('phx', 'https://us.posthog.com', {
        reportAuthErrors: false,
      }),
    ).rejects.toThrow();
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
