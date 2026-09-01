import { fetchLoginUrl } from '@ui/tui/hooks/useGithubConnection';
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
