vi.mock(import('@utils/links'), async (importOriginal) => ({
  ...(await importOriginal()),
  openTrackedLink: vi.fn(),
  openTrackedLinkOrFail: vi.fn(),
}));
vi.mock(import('@tui/abort'), () => ({
  abortOnScreens: vi.fn(() => Promise.reject(new Error('aborted'))),
}));
vi.mock(import('@utils/analytics'), () => ({
  analytics: { wizardCapture: vi.fn(), captureException: vi.fn() } as never,
}));
vi.mock(import('@utils/debug'));

import axios from 'axios';
import { ErrorCodes } from '@shared/errors';
import { abortOnScreens } from '@tui/abort';
import type { WizardStore } from '@tui/store';
import { openTrackedLink, openTrackedLinkOrFail } from '@utils/links';
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

describe('the OAuth flow when it signs up', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(axios, 'post').mockResolvedValue({ data: TOKEN });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stops with the sign-up error when no browser opens', async () => {
    vi.mocked(openTrackedLinkOrFail).mockResolvedValue(false);
    const { store, wizardStore } = fakeStore();

    await expect(
      performOAuthFlow({ scopes: ['user:read'], signup: true }, wizardStore),
    ).rejects.toThrow('aborted');

    expect(abortOnScreens).toHaveBeenCalledWith(
      wizardStore,
      expect.objectContaining({
        code: ErrorCodes.AuthSignupBrowserUnavailable,
        outroData: expect.objectContaining({
          body: expect.stringContaining('without --signup'),
        }),
      }),
    );
    expect(store.loginUrl).toBeNull();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('sends the browser to the login page, then logs in from its callback', async () => {
    vi.mocked(openTrackedLinkOrFail).mockResolvedValue(true);
    const { store, wizardStore } = fakeStore();

    const flow = performOAuthFlow(
      { scopes: ['user:read'], signup: true },
      wizardStore,
    );
    const loginUrl = await shownLoginUrl(store);
    const opened = await fetch(loginUrl, { redirect: 'manual' });
    await fetch(new URL('/callback?code=abc', loginUrl));

    await expect(flow).resolves.toMatchObject({ access_token: 'pha_new' });
    const authorize = new URL(opened.headers.get('location') ?? '');
    // The OAuth proxy serves only `/oauth/authorize`; its login page sends a new email to sign-up.
    expect(authorize.pathname).toBe('/oauth/authorize');
    expect(abortOnScreens).not.toHaveBeenCalled();
  });

  it('keeps the manual-paste fallback for a login with no browser', async () => {
    const { store, wizardStore, pasteCode } = fakeStore();

    const flow = performOAuthFlow({ scopes: ['user:read'] }, wizardStore);
    await shownLoginUrl(store);
    pasteCode('abc');

    await expect(flow).resolves.toMatchObject({ access_token: 'pha_new' });
    expect(openTrackedLink).toHaveBeenCalled();
    expect(openTrackedLinkOrFail).not.toHaveBeenCalled();
    expect(abortOnScreens).not.toHaveBeenCalled();
  });
});
