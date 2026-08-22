import {
  buildWizardPropertiesBlob,
  gatewayAuth,
  isTrustedGatewayUrl,
  refreshSlackMs,
  resetGatewaySession,
} from '@lib/gateway-session';
import type { HostResolution } from '@lib/host-resolution';

const host = {
  apiHost: 'https://us.posthog.com',
  gatewayUrl: 'https://gateway.us.posthog.com/wizard',
} as unknown as HostResolution;

describe('gatewayAuth', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetGatewaySession();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves the v2 posture from a mint response and caches it', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          token: 'phe_minted',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          gateway_url: 'https://gateway.us.posthog.com',
          team_id: 42,
        }),
    });

    const auth = await gatewayAuth(host, 'pha_oauth');
    expect(auth).toEqual({
      gatewayUrl: 'https://gateway.us.posthog.com',
      token: 'phe_minted',
      edition: 'v2',
      teamId: 42,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://us.posthog.com/api/wizard/gateway_token/',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer pha_oauth',
        }),
      }),
    );

    // Second resolve inside the TTL reuses the cache — no second mint.
    await gatewayAuth(host, 'pha_oauth');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('prefers the server-reported lifetime over the local clock', async () => {
    // A skewed client clock must not make a valid token look expired.
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          token: 'phe_skew',
          expires_at: new Date(Date.now() - 3600_000).toISOString(),
          expires_in: 3600,
          gateway_url: 'https://ai-gateway.us.posthog.com',
        }),
    });
    const auth = await gatewayAuth(host, 'pha_oauth');
    expect(auth.edition).toBe('v2');
    expect(auth.token).toBe('phe_skew');
  });

  it('serves a short-TTL token from cache instead of re-minting every call', async () => {
    // A fixed five-minute margin subtracted from a five-minute token lands in
    // the past, which made the cache a permanent miss.
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          token: 'phe_short',
          expires_at: new Date(Date.now() + 300_000).toISOString(),
          gateway_url: 'https://ai-gateway.us.posthog.com',
        }),
    });

    const first = await gatewayAuth(host, 'pha_oauth');
    const second = await gatewayAuth(host, 'pha_oauth');
    expect(first.token).toBe('phe_short');
    expect(second.token).toBe('phe_short');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mints once for concurrent callers', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          token: 'phe_shared',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          gateway_url: 'https://ai-gateway.us.posthog.com',
        }),
    });

    const results = await Promise.all([
      gatewayAuth(host, 'pha_oauth'),
      gatewayAuth(host, 'pha_oauth'),
      gatewayAuth(host, 'pha_oauth'),
    ]);
    expect(results.map((r) => r.token)).toEqual([
      'phe_shared',
      'phe_shared',
      'phe_shared',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches the legacy fallback instead of re-minting per caller', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    await gatewayAuth(host, 'pha_oauth');
    await gatewayAuth(host, 'pha_oauth');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['gateway_url', { token: 't', expires_at: 'z' }],
    [
      'token',
      { gateway_url: 'https://ai-gateway.us.posthog.com', expires_at: 'z' },
    ],
    [
      'expires_at',
      { token: 't', gateway_url: 'https://ai-gateway.us.posthog.com' },
    ],
  ])('falls back when the mint response omits %s', async (_field, body) => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(body),
    });
    const auth = await gatewayAuth(host, 'pha_oauth');
    expect(auth.edition).toBe('legacy');
  });

  it('falls back when the mint returns a token too short to be worth caching', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          token: 'phe_dying',
          // Under the usable threshold: the refresh margin would eat almost
          // the whole lifetime and every caller would re-mint.
          expires_at: new Date(Date.now() + 45_000).toISOString(),
          gateway_url: 'https://ai-gateway.us.posthog.com',
        }),
    });
    const auth = await gatewayAuth(host, 'pha_oauth');
    // A token with seconds of life would 401 mid-run, and the subprocess holds
    // it for the whole session.
    expect(auth.edition).toBe('legacy');
  });

  it('falls back when the mint returns an already-expired token', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          token: 'phe_expired',
          expires_at: new Date(Date.now() - 1_000).toISOString(),
          gateway_url: 'https://ai-gateway.us.posthog.com',
        }),
    });
    const auth = await gatewayAuth(host, 'pha_oauth');
    expect(auth.edition).toBe('legacy');
  });

  it('refuses a gateway url outside the trusted origins', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          token: 'phe_x',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          gateway_url: 'https://evil.example.com',
        }),
    });
    const auth = await gatewayAuth(host, 'pha_oauth');
    expect(auth.edition).toBe('legacy');
    expect(auth.gatewayUrl).toBe(host.gatewayUrl);
  });

  it('falls back to the legacy posture when the backend does not mint', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    const auth = await gatewayAuth(host, 'pha_oauth');
    expect(auth).toEqual({
      gatewayUrl: host.gatewayUrl,
      token: 'pha_oauth',
      edition: 'legacy',
    });
  });

  it('falls back to legacy on a transport failure', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    const auth = await gatewayAuth(host, 'pha_oauth');
    expect(auth.edition).toBe('legacy');
    expect(auth.token).toBe('pha_oauth');
  });

  it('falls back to legacy on a malformed mint response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'phe_minted' }), // missing gateway_url/expires_at
    });

    const auth = await gatewayAuth(host, 'pha_oauth');
    expect(auth.edition).toBe('legacy');
  });
});

describe('buildWizardPropertiesBlob', () => {
  it('carries metadata under plain keys, flags as wizard_flag_*, and team_id', () => {
    const blob = JSON.parse(
      buildWizardPropertiesBlob(
        { run_id: 'r1', 'X-POSTHOG-PROPERTY-integration': 'nextjs' },
        { 'wizard-orchestrator': 'test', 'unrelated-flag': 'x' },
        42,
      ),
    );
    expect(blob).toEqual({
      team_id: 42,
      run_id: 'r1',
      integration: 'nextjs',
      'wizard_flag_wizard-orchestrator': 'test',
    });
  });

  it('never emits $-prefixed keys (the gateway strips them as reserved)', () => {
    const blob = JSON.parse(
      buildWizardPropertiesBlob({ run_id: 'r1' }, { 'wizard-x': 'v' }),
    );
    for (const key of Object.keys(blob)) {
      expect(key.startsWith('$')).toBe(false);
    }
  });
});

describe('refreshSlackMs', () => {
  it('never spends more than a fifth of a short token life', () => {
    expect(refreshSlackMs(300_000)).toBe(60_000);
  });

  it('caps at the fixed margin for a long token life', () => {
    expect(refreshSlackMs(24 * 3600_000)).toBe(5 * 60 * 1000);
  });

  it('is zero for an already-expired token', () => {
    expect(refreshSlackMs(-1)).toBe(0);
  });

  it("floors at one request's worth of life for a very short token", () => {
    // A fifth of 60s is 12s, which is less than a single request needs.
    expect(refreshSlackMs(60_000)).toBe(30_000);
  });
});

describe('isTrustedGatewayUrl', () => {
  const api = 'https://us.posthog.com';

  it.each([
    'https://ai-gateway.us.posthog.com',
    'https://ai-gateway.eu.posthog.com',
    'http://localhost:3308',
  ])('accepts %s', (value) => {
    expect(isTrustedGatewayUrl(value, api)).toBe(true);
  });

  it.each([
    'https://evil.example.com',
    'http://ai-gateway.us.posthog.com',
    'not-a-url',
    'https://posthog.com.evil.example',
    'https://x.posthog.com.evil.io',
    // Userinfo: the real host is evil.com.
    'https://ai-gateway.us.posthog.com@evil.com',
    // Consumers append routes, so anything past the origin is refused.
    'https://ai-gateway.us.posthog.com/wizard',
    'https://ai-gateway.us.posthog.com/?x=1',
  ])('refuses %s', (value) => {
    expect(isTrustedGatewayUrl(value, api)).toBe(false);
  });

  it('accepts the docker dev gateway host', () => {
    expect(isTrustedGatewayUrl('http://host.docker.internal:3308', api)).toBe(
      true,
    );
  });

  it('accepts a self-hosted install on its own api host', () => {
    expect(
      isTrustedGatewayUrl(
        'https://ph.internal.example',
        'https://ph.internal.example',
      ),
    ).toBe(true);
  });
});
