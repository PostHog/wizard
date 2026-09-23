import axios from 'axios';
import { performOAuthFlow, type OAuthFlowHost } from '@utils/oauth';

// Port 0: the OS picks a free callback port, so parallel runs never collide.
vi.mock('@shared/config/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/config/constants')>()),
  OAUTH_PORTS: [0],
}));
vi.mock('axios');
vi.mock('@utils/links', () => ({
  openTrackedLink: vi.fn(),
  withUtm: (url: string) => url,
}));
vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn(), captureException: vi.fn() },
}));
// The flow reports through its host. Reaching for the UI singleton fails.
vi.mock('@cli/ui', () => ({
  getUI: () => {
    throw new Error('OAuth flow reached for getUI()');
  },
}));

function recordingHost(): { host: OAuthFlowHost; events: string[] } {
  const events: string[] = [];
  const host: OAuthFlowHost = {
    log: {
      info: (m) => events.push(`info ${m}`),
      warn: (m) => events.push(`warn ${m}`),
      error: (m) => events.push(`error ${m}`),
    },
    spinner: () => ({
      start: (m) => events.push(`spinner start ${m ?? ''}`),
      stop: (m) => events.push(`spinner stop ${m ?? ''}`),
      message: (m) => events.push(`spinner message ${m ?? ''}`),
    }),
    setLoginUrl: (url) =>
      events.push(`loginUrl ${url === null ? 'cleared' : 'set'}`),
    setAuthorizeUrl: (url) =>
      events.push(`authorizeUrl ${url === null ? 'cleared' : 'set'}`),
    waitForManualAuthCode: () => {
      events.push('manual code requested');
      return Promise.resolve('pasted-code');
    },
    showSessionTimeout: () => events.push('session timeout'),
    showPortConflict: () => {
      events.push('port conflict');
      return Promise.resolve();
    },
    abort: () => Promise.reject(new Error('aborted')),
  };
  return { host, events };
}

describe('performOAuthFlow host', () => {
  it('shows the login, takes a pasted code and clears the login through the host', async () => {
    (axios.post as Mock).mockResolvedValue({
      data: {
        access_token: 'pha_token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'user:read project:read',
      },
    });
    const { host, events } = recordingHost();

    const token = await performOAuthFlow(
      { scopes: ['user:read', 'project:read'], signup: false },
      host,
    );

    expect(token.access_token).toBe('pha_token');
    expect(events).toEqual([
      'loginUrl set',
      'authorizeUrl set',
      'spinner start Waiting for authorization...',
      'manual code requested',
      'loginUrl cleared',
      'authorizeUrl cleared',
      'spinner stop Authorization complete!',
    ]);
  });

  it('warns through the host when the grant is narrower than the request', async () => {
    (axios.post as Mock).mockResolvedValue({
      data: {
        access_token: 'pha_token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'user:read',
      },
    });
    const { host, events } = recordingHost();

    await performOAuthFlow(
      { scopes: ['user:read', 'project:read'], signup: false },
      host,
    );

    expect(
      events.some((e) =>
        e.startsWith(
          'warn Your PostHog authorization is missing a permission the wizard asked for: project:read.',
        ),
      ),
    ).toBe(true);
  });
});
