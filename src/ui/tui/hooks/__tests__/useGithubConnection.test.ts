import {
  fetchLoginUrl,
  pollGithubConnection,
} from '@ui/tui/hooks/useGithubConnection';
import { ApiError, fetchGithubConnected } from '@lib/api';
import { refreshAccessTokenIfNeeded } from '@lib/session-token';
import type { WizardStore } from '@ui/tui/store';
import type { WizardSession, Credentials } from '@lib/wizard-session';
import type { HostResolution } from '@lib/host-resolution';
import { requestDeepLink } from '@utils/provisioning';

vi.mock('@lib/api', async () => {
  const actual = await vi.importActual<typeof import('@lib/api')>('@lib/api');
  return { ApiError: actual.ApiError, fetchGithubConnected: vi.fn() };
});
vi.mock('@lib/session-token', () => ({
  refreshAccessTokenIfNeeded: vi.fn().mockResolvedValue(false),
}));
vi.mock('@utils/debug', () => ({ getLogFilePath: () => '/tmp/wizard.log' }));
vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn(), captureException: vi.fn() },
}));
vi.mock('@utils/provisioning', () => ({ requestDeepLink: vi.fn() }));

const mockedFetch = fetchGithubConnected as Mock;
const mockedRefresh = refreshAccessTokenIfNeeded as Mock;
const mockedDeepLink = requestDeepLink as Mock;

const host = { appHost: 'https://us.posthog.com' } as HostResolution;

/** Minimal store double — the poll only reads credentials and calls two setters. */
function storeDouble() {
  const session = {
    credentials: {
      accessToken: 'pha_old',
      projectId: 1,
      host: { apiHost: 'https://us.posthog.com' },
    },
    githubConnected: null as boolean | null,
  };
  return {
    session,
    setGithubConnected: vi.fn((v: boolean) => {
      session.githubConnected = v;
    }),
    showAuthError: vi.fn(),
  } as unknown as WizardStore & { showAuthError: Mock };
}

/** Cancels the poll once it has made `ticks` calls, so the loop terminates. */
function abortAfter(controller: AbortController, ticks: number): void {
  let seen = 0;
  mockedFetch.mockImplementation(() => {
    if (++seen >= ticks) controller.abort();
    return Promise.reject(new ApiError('Authentication failed', 401));
  });
}

const run = (store: WizardStore, controller = new AbortController()) =>
  pollGithubConnection(
    store,
    { refreshAttempted: false, sawAuthFailure: false, errorReported: false },
    controller.signal,
    0,
  );

function sessionWith(over: Partial<WizardSession>): WizardSession {
  return {
    signup: false,
    credentials: { accessToken: 'pha_x', host } as Credentials,
    ...over,
  } as WizardSession;
}

describe('pollGithubConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRefresh.mockResolvedValue(false);
  });

  it('refreshes the token before the first check, since nothing else does before this screen', async () => {
    const store = storeDouble();
    mockedFetch.mockResolvedValueOnce(true);

    await run(store);

    expect(mockedRefresh).toHaveBeenCalledWith(store.session);
    expect(store.setGithubConnected).toHaveBeenCalledWith(true);
  });

  it('forces one refresh when the server rejects the token, and retries with the new one', async () => {
    const store = storeDouble();
    mockedRefresh
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    mockedFetch
      .mockRejectedValueOnce(new ApiError('Authentication failed', 401))
      .mockResolvedValueOnce(true);

    await run(store);

    expect(mockedRefresh).toHaveBeenLastCalledWith(store.session, {
      force: true,
    });
    expect(store.setGithubConnected).toHaveBeenCalledWith(true);
    expect(store.showAuthError).not.toHaveBeenCalled();
  });

  it('names the expired login instead of polling a dead token forever', async () => {
    const store = storeDouble();
    const controller = new AbortController();
    abortAfter(controller, 10);

    await run(store, controller);

    expect(store.showAuthError).toHaveBeenCalledWith(
      expect.objectContaining({ sessionExpired: true }),
    );
    // Gave up on the second rejection rather than running to the abort.
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps polling through a non-auth failure, which a retry can still resolve', async () => {
    const store = storeDouble();
    const controller = new AbortController();
    let seen = 0;
    mockedFetch.mockImplementation(() => {
      if (++seen >= 3) controller.abort();
      return Promise.reject(new ApiError('Failed to reach PostHog', 503));
    });

    await run(store, controller);

    expect(store.showAuthError).not.toHaveBeenCalled();
    expect(store.setGithubConnected).toHaveBeenCalledWith(false);
    expect(mockedFetch).toHaveBeenCalledTimes(3);
  });
});

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
