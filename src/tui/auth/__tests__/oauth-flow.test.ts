vi.mock(import('@utils/links'), async (importOriginal) => ({
  ...(await importOriginal()),
  openTrackedLink: vi.fn(),
}));
vi.mock(import('@tui/abort'), () => ({
  abortOnScreens: vi.fn(() => Promise.reject(new Error('aborted'))),
}));
vi.mock(import('@utils/analytics'), () => ({
  analytics: { wizardCapture: vi.fn(), captureException: vi.fn() } as never,
}));
vi.mock(import('@utils/debug'));

import axios from 'axios';
import * as net from 'node:net';
import { abortOnScreens } from '@tui/abort';
import type { WizardStore } from '@tui/store';
import { analytics } from '@utils/analytics';
import { openTrackedLink } from '@utils/links';
import { performOAuthFlow } from '../oauth';

const TOKEN = {
  access_token: 'pha_new',
  expires_in: 3600,
  token_type: 'bearer',
  scope: 'user:read event_definition:write',
};

/** The store slice the OAuth flow writes to; `pasteCode` stands in for the manual-paste modal. */
function fakeStore() {
  let pasteCode: (code: string) => void = () => undefined;
  const pasted = new Promise<string>((resolve) => {
    pasteCode = resolve;
  });
  const store = {
    loginUrl: null as string | null,
    setLoginUrl(url: string | null) {
      store.loginUrl = url;
    },
    setAuthorizeUrl: vi.fn(),
    closeManualAuthCode: vi.fn(),
    pushStatus: vi.fn(),
    showSessionTimeout: vi.fn(),
    waitForManualAuthCode: () => pasted,
  };
  return { store, wizardStore: store as unknown as WizardStore, pasteCode };
}

/** Resolves with the first login URL the flow shows. */
function shownLoginUrl(store: { loginUrl: string | null }): Promise<string> {
  return vi.waitFor(() => {
    if (!store.loginUrl) throw new Error('no login URL yet');
    return store.loginUrl;
  });
}

describe('the OAuth flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(axios, 'post').mockResolvedValue({ data: TOKEN });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the browser to the login page, then logs in from its callback', async () => {
    const { store, wizardStore } = fakeStore();

    const flow = performOAuthFlow({ scopes: ['user:read'] }, wizardStore);
    const loginUrl = await shownLoginUrl(store);
    const opened = await fetch(loginUrl, { redirect: 'manual' });
    await fetch(new URL('/callback?code=abc', loginUrl));

    await expect(flow).resolves.toMatchObject({ access_token: 'pha_new' });
    const authorize = opened.headers.get('location') ?? '';
    // The OAuth proxy serves only `/oauth/authorize`; its login page sends a new email to sign-up.
    expect(new URL(authorize).pathname).toBe('/oauth/authorize');
    expect(openTrackedLink).toHaveBeenCalledWith(loginUrl, 'oauth', {
      auto: true,
      skipUtm: true,
    });
    // A remote shell cannot reach localhost, so the paste modal links PostHog directly.
    expect(store.setAuthorizeUrl).toHaveBeenNthCalledWith(1, authorize);
    // A paste modal left open would cover the screens after login.
    expect(store.closeManualAuthCode).toHaveBeenCalled();
    expect(abortOnScreens).not.toHaveBeenCalled();
  });

  it('keeps the manual-paste fallback for a login with no browser', async () => {
    const { store, wizardStore, pasteCode } = fakeStore();

    const flow = performOAuthFlow({ scopes: ['user:read'] }, wizardStore);
    await shownLoginUrl(store);
    pasteCode('abc');

    await expect(flow).resolves.toMatchObject({ access_token: 'pha_new' });
    expect(abortOnScreens).not.toHaveBeenCalled();
  });

  it.each([
    [
      'access_denied',
      'Authorization was cancelled',
      'PHW_AUTH_ACCESS_DENIED',
      'cancelled',
    ],
    ['invalid_scope', 'invalid_scope', 'PHW_AUTH_LOGIN_FAILED', 'error'],
  ])(
    'stops the login when the callback carries %s, says why, and frees its port',
    async (oauthError, shown, code, status) => {
      const { store, wizardStore } = fakeStore();

      const flow = performOAuthFlow({ scopes: ['user:read'] }, wizardStore);
      // Attached before the callback, because the flow rejects while the fetch is still in flight.
      const failed = expect(flow).rejects.toThrow('aborted');
      const loginUrl = await shownLoginUrl(store);
      await fetch(new URL(`/callback?error=${oauthError}`, loginUrl));

      await failed;
      // The outro is the only screen left, so the reason must reach it.
      expect(abortOnScreens).toHaveBeenCalledWith(wizardStore, {
        message: expect.stringContaining(shown),
        code,
        status,
        error: expect.objectContaining({
          context: expect.objectContaining({
            $exception_fingerprint: `wizard_oauth_${oauthError}`,
          }),
        }),
      });
      // abortOnScreens captures the error; a second capture here would count it twice.
      expect(analytics.captureException).not.toHaveBeenCalled();
      expect(axios.post).not.toHaveBeenCalled();
      // The next login listens on the same port, so the failed one must have released it.
      const reuse = net.createServer();
      await new Promise<void>((resolve, reject) => {
        reuse.once('error', reject);
        reuse.listen(Number(new URL(loginUrl).port), resolve);
      });
      reuse.close();
    },
  );
});
