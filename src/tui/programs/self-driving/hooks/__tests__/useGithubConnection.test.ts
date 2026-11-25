import { checkGithubConnected } from '@tui/programs/self-driving/hooks/useGithubConnection';
import { fetchGithubConnected } from '@shared/api';
import {
  configureOAuthSession,
  resetOAuthSession,
} from '@shared/oauth-session';
import type { Credentials } from '@shared/api';
import type { HostResolution } from '@shared/host-resolution';
import type { WizardStore } from '@tui/store';

vi.mock('@shared/api', () => ({ fetchGithubConnected: vi.fn() }));

const mockedFetchGithub = fetchGithubConnected as Mock;

describe('checkGithubConnected', () => {
  const login = (over: Partial<Credentials> = {}): Credentials =>
    ({
      accessToken: 'pha_old',
      refreshToken: 'phr_old',
      expiresAt: Date.now() + 60 * 60 * 1000,
      projectId: 42,
      host: { apiHost: 'https://us.i.posthog.com' } as HostResolution,
      ...over,
    } as Credentials);

  // The only slice of WizardStore the check reads.
  const storeWith = (credentials: Credentials) =>
    ({ session: { credentials } } as unknown as WizardStore);

  const rotateTo =
    (accessToken: string) =>
    (held: Credentials): Promise<Credentials> =>
      Promise.resolve({
        ...held,
        accessToken,
        expiresAt: Date.now() + 60 * 60 * 1000,
      });

  const unauthorized = () =>
    Object.assign(new Error('Request failed with status code 401'), {
      isAxiosError: true,
      response: { status: 401 },
    });

  const signal = () => new AbortController().signal;

  beforeEach(() => {
    vi.clearAllMocks();
    resetOAuthSession();
  });

  // The gate outlives the 1-hour token: without a retry every later tick 401s
  // and the screen asks for an install the project already has.
  it('rotates the token once on a 401 and retries with the new one', async () => {
    const held = login();
    configureOAuthSession(held, { rotate: rotateTo('pha_new') });
    mockedFetchGithub
      .mockRejectedValueOnce(unauthorized())
      .mockResolvedValueOnce(true);

    await expect(checkGithubConnected(storeWith(held), signal())).resolves.toBe(
      true,
    );
    expect(mockedFetchGithub).toHaveBeenLastCalledWith(
      'pha_new',
      42,
      'https://us.i.posthog.com',
      expect.any(AbortSignal),
    );
  });

  // The gate can open more than an hour after login, after a long integration run.
  it('refreshes an expired token before the first check', async () => {
    const held = login({ expiresAt: Date.now() - 1000 });
    configureOAuthSession(held, { rotate: rotateTo('pha_new') });
    mockedFetchGithub.mockResolvedValueOnce(true);

    await checkGithubConnected(storeWith(held), signal());

    expect(mockedFetchGithub).toHaveBeenCalledTimes(1);
    expect(mockedFetchGithub.mock.calls[0][0]).toBe('pha_new');
  });

  it('throws a 401 the refresh cannot fix rather than looping', async () => {
    const held = login();
    configureOAuthSession(held, { rotate: (same) => Promise.resolve(same) });
    mockedFetchGithub.mockRejectedValue(unauthorized());

    await expect(
      checkGithubConnected(storeWith(held), signal()),
    ).rejects.toThrow('401');
    expect(mockedFetchGithub).toHaveBeenCalledTimes(1);
  });
});
