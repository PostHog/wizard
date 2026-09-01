import { fetchSignupLoginUrl } from '@ui/tui/hooks/useGithubConnection';
import { requestDeepLink } from '@utils/provisioning';
import type { WizardSession, Credentials } from '@lib/wizard-session';
import type { HostResolution } from '@lib/host-resolution';

vi.mock('@utils/provisioning', () => ({ requestDeepLink: vi.fn() }));

const mockedDeepLink = requestDeepLink as Mock;

const host = { appHost: 'https://us.posthog.com' } as HostResolution;

function sessionWith(over: Partial<WizardSession>): WizardSession {
  return {
    signup: false,
    credentials: { accessToken: 'pha_x', host } as Credentials,
    ...over,
  } as WizardSession;
}

describe('fetchSignupLoginUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips non-signup sessions, whose browser already holds a login', async () => {
    await expect(fetchSignupLoginUrl(sessionWith({}))).resolves.toBeNull();
    expect(mockedDeepLink).not.toHaveBeenCalled();
  });

  it('skips a session without credentials', async () => {
    await expect(
      fetchSignupLoginUrl(sessionWith({ signup: true, credentials: null })),
    ).resolves.toBeNull();
    expect(mockedDeepLink).not.toHaveBeenCalled();
  });

  it('returns a one-time login link for a provisioning signup', async () => {
    mockedDeepLink.mockResolvedValueOnce('https://us.posthog.com/login/once');

    await expect(
      fetchSignupLoginUrl(sessionWith({ signup: true })),
    ).resolves.toBe('https://us.posthog.com/login/once');
    expect(mockedDeepLink).toHaveBeenCalledWith('pha_x', host);
  });

  it('returns null when the deep link request fails', async () => {
    mockedDeepLink.mockResolvedValueOnce(null);

    await expect(
      fetchSignupLoginUrl(sessionWith({ signup: true })),
    ).resolves.toBeNull();
  });
});
