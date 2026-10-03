import {
  checkGithubConnected,
  fetchLoginUrl,
} from '@tui/programs/self-driving/hooks/useGithubConnection';
import { requestDeepLink } from '@utils/provisioning';
import { fetchGithubConnected } from '@shared/api';
import {
  configureOAuthSession,
  resetOAuthSession,
} from '@shared/oauth-session';
import type {
  WizardSession,
  Credentials,
} from '@programs/session/wizard-session';
import type { HostResolution } from '@shared/host-resolution';
import type { WizardStore } from '@tui/store';

vi.mock('@utils/provisioning', () => ({ requestDeepLink: vi.fn() }));
vi.mock('@shared/api', () => ({ fetchGithubConnected: vi.fn() }));

const mockedDeepLink = requestDeepLink as Mock;
const mockedFetchGithub = fetchGithubConnected as Mock;

const host = { appHost: 'https://us.posthog.com' } as HostResolution;

function sessionWith(over: Partial<WizardSession>): WizardSession {
  return {
    signup: false,
    credentials: { accessToken: 'pha_x', host } as Credentials,
    ...over,
  } as WizardSession;
}

describe('fetchLoginUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips non-signup sessions, whose browser already holds a login', async () => {
    await expect(fetchLoginUrl(sessionWith({}))).resolves.toBeNull();
    expect(mockedDeepLink).not.toHaveBeenCalled();
  });

  it('skips a session without credentials', async () => {
    await expect(
      fetchLoginUrl(sessionWith({ signup: true, credentials: null })),
    ).resolves.toBeNull();
    expect(mockedDeepLink).not.toHaveBeenCalled();
  });

  it('prefers a one-time deep link when the partner tier grants one', async () => {
    mockedDeepLink.mockResolvedValueOnce('https://us.posthog.com/login/once');

    await expect(fetchLoginUrl(sessionWith({ signup: true }))).resolves.toBe(
      'https://us.posthog.com/login/once',
    );
    expect(mockedDeepLink).toHaveBeenCalledWith('pha_x', host);
  });

  // deep_links is partner-tier gated (403 today), so signups must still get a working link.
  it('falls back to the login page when the deep link is refused', async () => {
    mockedDeepLink.mockResolvedValueOnce(null);

    await expect(fetchLoginUrl(sessionWith({ signup: true }))).resolves.toBe(
      'https://us.posthog.com/login',
    );
  });

  it('keeps the fallback on the credential host, so EU accounts land on EU login', async () => {
    mockedDeepLink.mockResolvedValueOnce(null);

    await expect(
      fetchLoginUrl(
        sessionWith({
          signup: true,
          credentials: {
            accessToken: 'pha_x',
            host: { appHost: 'https://eu.posthog.com' } as HostResolution,
          } as Credentials,
        }),
      ),
    ).resolves.toBe('https://eu.posthog.com/login');
  });
});

describe('checkGithubConnected', () => {
  const apiHost = { apiHost: 'https://us.i.posthog.com' } as HostResolution;
  const login = (over: Partial<Credentials> = {}): Credentials =>
    ({
      accessToken: 'pha_old',
      refreshToken: 'phr_old',
      expiresAt: Date.now() + 60 * 60 * 1000,
      projectId: 42,
      host: apiHost,
      ...over,
    } as Credentials);

  // Just the slice of WizardStore the check reads and writes.
  function storeWith(credentials: Credentials) {
    const store = {
      session: { credentials },
      setAccessToken: vi.fn((next: Credentials) => {
        store.session.credentials = next;
      }),
    };
    return store;
  }

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

  beforeEach(() => {
    vi.clearAllMocks();
    resetOAuthSession();
  });

  // The gate outlives the 1-hour token: without a retry every later tick 401s
  // and the screen asks for an install the project already has.
  it('rotates the token once on a 401 and retries with the new one', async () => {
    const held = login();
    const store = storeWith(held);
    configureOAuthSession(held, { rotate: rotateTo('pha_new') });
    mockedFetchGithub
      .mockRejectedValueOnce(unauthorized())
      .mockResolvedValueOnce(true);

    await expect(
      checkGithubConnected(
        store as unknown as WizardStore,
        new AbortController().signal,
      ),
    ).resolves.toBe(true);

    expect(mockedFetchGithub).toHaveBeenLastCalledWith(
      'pha_new',
      42,
      'https://us.i.posthog.com',
      expect.any(AbortSignal),
    );
    expect(store.session.credentials.accessToken).toBe('pha_new');
  });

  // The gate can open more than an hour after login, after a long integration run.
  it('refreshes an expired token before the first check', async () => {
    const held = login({ expiresAt: Date.now() - 1000 });
    const store = storeWith(held);
    configureOAuthSession(held, { rotate: rotateTo('pha_new') });
    mockedFetchGithub.mockResolvedValueOnce(true);

    await checkGithubConnected(
      store as unknown as WizardStore,
      new AbortController().signal,
    );

    expect(mockedFetchGithub).toHaveBeenCalledTimes(1);
    expect(mockedFetchGithub.mock.calls[0][0]).toBe('pha_new');
  });

  it('surfaces a 401 the refresh cannot fix rather than looping', async () => {
    const held = login();
    const store = storeWith(held);
    configureOAuthSession(held, { rotate: (same) => Promise.resolve(same) });
    mockedFetchGithub.mockRejectedValue(unauthorized());

    await expect(
      checkGithubConnected(
        store as unknown as WizardStore,
        new AbortController().signal,
      ),
    ).rejects.toThrow('401');
    expect(mockedFetchGithub).toHaveBeenCalledTimes(1);
  });
});
