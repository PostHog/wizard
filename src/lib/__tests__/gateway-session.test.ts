import {
  GatewayMintRefused,
  buildWizardPropertiesBlob,
  gatewayAuth,
  isTrustedGatewayUrl,
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

    // Second resolve inside the TTL reuses the cache, so no second mint.
    await gatewayAuth(host, 'pha_oauth');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves a short-lived token from cache instead of re-minting every call', async () => {
    // The refresh point is a fraction of the lifetime, so even a short token
    // has a usable cache window rather than being re-minted per call.
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
          // Under the adoption floor: too little life to serve a session.
          expires_at: new Date(Date.now() + 45_000).toISOString(),
          gateway_url: 'https://ai-gateway.us.posthog.com',
        }),
    });
    const auth = await gatewayAuth(host, 'pha_oauth');
    // A token with seconds of life would 401 mid-run, and the subprocess holds
    // it for the whole session.
    expect(auth.edition).toBe('legacy');
  });

  it.each([
    [429, 'daily run limit'],
    [400, 'did not recognise'],
    [403, 'access to this project'],
    [401, 'could not authenticate'],
  ])(
    'refuses rather than falling back on HTTP %i',
    async (status, fragment) => {
      fetchMock.mockResolvedValue({ ok: false, status });
      // Falling back would put the run on the legacy gateway, which enforces none
      // of the limits these statuses represent.
      await expect(gatewayAuth(host, 'pha_oauth')).rejects.toThrow(
        new RegExp(String(fragment), 'i'),
      );
    },
  );

  it.each([404, 500, 503])(
    'falls back when the mint is unavailable (HTTP %i)',
    async (status) => {
      fetchMock.mockResolvedValue({ ok: false, status });
      const auth = await gatewayAuth(host, 'pha_oauth');
      expect(auth.edition).toBe('legacy');
    },
  );

  it('surfaces a refusal through the transport catch', async () => {
    // The refusal is thrown from inside the try that wraps fetch, so a catch that
    // treats every throw as a transport failure would silently restore fallback.
    fetchMock.mockResolvedValue({ ok: false, status: 429 });
    await expect(gatewayAuth(host, 'pha_oauth')).rejects.toBeInstanceOf(
      GatewayMintRefused,
    );
  });

  it('falls back when the mint returns an unparseable expiry', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          token: 'phe_unknown_life',
          // Present and a string, so the response-shape check passes. Only
          // Date.parse rejects it, and an unknown lifetime cannot be adopted.
          expires_at: 'soon',
          gateway_url: 'https://ai-gateway.us.posthog.com',
        }),
    });
    const auth = await gatewayAuth(host, 'pha_oauth');
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
