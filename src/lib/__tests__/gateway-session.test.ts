import {
  GatewayMintFailed,
  GatewayMintRefused,
  buildWizardPropertiesBlob,
  gatewayAuth,
  isTrustedGatewayUrl,
  resetGatewaySession,
} from '@lib/gateway-session';
import type { HostResolution } from '@lib/host-resolution';
import { analytics } from '@utils/analytics';

vi.mock('@utils/analytics', () => ({
  analytics: { setTag: vi.fn(), captureException: vi.fn() },
}));

const host = {
  apiHost: 'https://us.posthog.com',
  gatewayUrl: 'https://gateway.us.posthog.com/wizard',
} as unknown as HostResolution;

describe('gatewayAuth', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetGatewaySession();
    fetchMock.mockReset();
    vi.mocked(analytics.setTag).mockClear();
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

    const auth = await gatewayAuth(host, 'pha_oauth', 'integration');
    expect(auth).toEqual({
      gatewayUrl: 'https://gateway.us.posthog.com',
      token: 'phe_minted',
      edition: 'v2',
      teamId: 42,
    });
    expect(analytics.setTag).toHaveBeenCalledWith('gateway_edition', 'v2');
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
    await gatewayAuth(host, 'pha_oauth', 'integration');
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

    const first = await gatewayAuth(host, 'pha_oauth', 'integration');
    const second = await gatewayAuth(host, 'pha_oauth', 'integration');
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
      gatewayAuth(host, 'pha_oauth', 'integration'),
      gatewayAuth(host, 'pha_oauth', 'integration'),
      gatewayAuth(host, 'pha_oauth', 'integration'),
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

    await gatewayAuth(host, 'pha_oauth', 'integration');
    await gatewayAuth(host, 'pha_oauth', 'integration');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Every field except the one under test is valid, so the named guard is the
  // sole reason the call fails. Filling the others with junk (an unparseable
  // expiry, say) makes the TTL guard throw first and every case pass for the
  // wrong reason, leaving each per-field check deletable with the suite green.
  it.each([
    ['gateway_url', 'omitted gateway_url'],
    ['token', 'omitted token'],
    ['expires_at', 'omitted expires_at'],
  ])('fails the run when the mint response omits %s', async (field, want) => {
    const body: Record<string, unknown> = {
      token: 'phe_ok',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      gateway_url: 'https://ai-gateway.us.posthog.com',
    };
    delete body[field];
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(body),
    });
    await expect(gatewayAuth(host, 'pha_oauth', 'integration')).rejects.toThrow(
      want,
    );
  });

  it('fails the run when the mint returns a token too short to be worth caching', async () => {
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
    // A token with seconds of life would 401 mid-run, and the subprocess holds
    // it for the whole session.
    await expect(
      gatewayAuth(host, 'pha_oauth', 'integration'),
    ).rejects.toBeInstanceOf(GatewayMintFailed);
  });

  it.each([
    [429, 'daily run limit'],
    [400, 'exactly one project'],
    [403, 'access to this project'],
    [401, 'could not authenticate'],
  ])(
    'refuses rather than falling back on HTTP %i',
    async (status, fragment) => {
      fetchMock.mockResolvedValue({ ok: false, status });
      // Falling back would put the run on the legacy gateway, which enforces none
      // of the limits these statuses represent.
      await expect(
        gatewayAuth(host, 'pha_oauth', 'integration'),
      ).rejects.toThrow(new RegExp(String(fragment), 'i'));
    },
  );

  it('stays on the existing gateway when the org is not rolled out (404)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    // The one surviving downgrade: 404 is the staged-rollout switch, so removing
    // it would make the flip all-or-nothing.
    const auth = await gatewayAuth(host, 'pha_oauth', 'integration');
    expect(auth.edition).toBe('legacy');
    expect(analytics.setTag).toHaveBeenCalledWith('gateway_edition', 'legacy');
  });

  it.each([500, 502, 503])(
    'fails the run when the mint errors (HTTP %i)',
    async (status) => {
      fetchMock.mockResolvedValue({ ok: false, status });
      // Downgrading here would spend the whole run uncapped and unattributed to
      // hide an outage.
      await expect(
        gatewayAuth(host, 'pha_oauth', 'integration'),
      ).rejects.toBeInstanceOf(GatewayMintFailed);
    },
  );

  it('surfaces a refusal through the transport catch', async () => {
    // The refusal is thrown from inside the try that wraps fetch, so a catch that
    // treats every throw as a transport failure would silently restore fallback.
    fetchMock.mockResolvedValue({ ok: false, status: 429 });
    await expect(
      gatewayAuth(host, 'pha_oauth', 'integration'),
    ).rejects.toBeInstanceOf(GatewayMintRefused);
  });

  it("names the run's program in the mint request", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          token: 'phe_minted',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          gateway_url: 'https://gateway.us.posthog.com',
        }),
    });

    await gatewayAuth(host, 'pha_oauth', 'audit');

    // The backend pins `wizard:<program>` from this field; without it the mint
    // has nothing to attribute the run to and refuses.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ program: 'audit' }) }),
    );
  });

  it('fails the run when it has no program', async () => {
    // An absent id means a caller was not wired, and its spend would be
    // unattributable. Never mints, so it cannot be a refusal either.
    await expect(
      gatewayAuth(host, 'pha_oauth', undefined),
    ).rejects.toBeInstanceOf(GatewayMintFailed);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches per program rather than per session', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          token: 'phe_minted',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          gateway_url: 'https://gateway.us.posthog.com',
        }),
    });

    await gatewayAuth(host, 'pha_oauth', 'audit');
    await gatewayAuth(host, 'pha_oauth', 'integration');

    // A token is pinned to one program's node at mint, so reusing it across
    // programs would bill the wrong budget.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails the run when the mint returns an unparseable expiry', async () => {
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
    await expect(
      gatewayAuth(host, 'pha_oauth', 'integration'),
    ).rejects.toBeInstanceOf(GatewayMintFailed);
  });

  it('fails the run when the mint returns an already-expired token', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          token: 'phe_expired',
          expires_at: new Date(Date.now() - 1_000).toISOString(),
          gateway_url: 'https://ai-gateway.us.posthog.com',
        }),
    });
    await expect(
      gatewayAuth(host, 'pha_oauth', 'integration'),
    ).rejects.toBeInstanceOf(GatewayMintFailed);
  });

  it('re-mints once the cached token passes its refresh point', async () => {
    // Without moving the clock nothing ever crosses staleAtMs, so the refresh
    // fraction and the staleness check are both mutation survivors: widening
    // either stops the token refreshing and every other test stays green.
    vi.useFakeTimers();
    try {
      const ttlMs = 60 * 60 * 1000;
      fetchMock.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              token: 'phe_minted',
              expires_at: new Date(Date.now() + ttlMs).toISOString(),
              gateway_url: 'https://gateway.us.posthog.com',
            }),
        }),
      );

      await gatewayAuth(host, 'pha_oauth', 'integration');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Just short of the refresh point: still served from cache.
      vi.setSystemTime(Date.now() + ttlMs * 0.79);
      await gatewayAuth(host, 'pha_oauth', 'integration');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Past it: re-resolved.
      vi.setSystemTime(Date.now() + ttlMs * 0.05);
      await gatewayAuth(host, 'pha_oauth', 'integration');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries cleanly after a failed mint rather than wedging the session', async () => {
    // A rejected resolve must leave neither a cached posture nor a claimed
    // in-flight slot behind, or one transient 503 wedges the run for the
    // process lifetime.
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(
      gatewayAuth(host, 'pha_oauth', 'integration'),
    ).rejects.toBeInstanceOf(GatewayMintFailed);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          token: 'phe_after_retry',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          gateway_url: 'https://gateway.us.posthog.com',
        }),
    });
    const auth = await gatewayAuth(host, 'pha_oauth', 'integration');
    expect(auth.token).toBe('phe_after_retry');
  });

  it('rejects every concurrent joiner when the shared mint fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    // All three join one in-flight promise; a joiner that resolved instead would
    // be running on a posture nobody validated.
    const results = await Promise.allSettled([
      gatewayAuth(host, 'pha_oauth', 'integration'),
      gatewayAuth(host, 'pha_oauth', 'integration'),
      gatewayAuth(host, 'pha_oauth', 'integration'),
    ]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    await expect(
      gatewayAuth(host, 'pha_oauth', 'integration'),
    ).rejects.toBeInstanceOf(GatewayMintFailed);
  });

  it('falls back to the legacy posture when the backend does not mint', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    const auth = await gatewayAuth(host, 'pha_oauth', 'integration');
    expect(auth).toEqual({
      gatewayUrl: host.gatewayUrl,
      token: 'pha_oauth',
      edition: 'legacy',
    });
  });

  it('fails the run on a transport failure', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(
      gatewayAuth(host, 'pha_oauth', 'integration'),
    ).rejects.toBeInstanceOf(GatewayMintFailed);
  });

  it('fails the run on a malformed mint response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'phe_minted' }), // missing gateway_url/expires_at
    });

    await expect(
      gatewayAuth(host, 'pha_oauth', 'integration'),
    ).rejects.toBeInstanceOf(GatewayMintFailed);
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
