import { inspect } from 'node:util';
import {
  GatewayMintFailed,
  GatewayMintRefused,
  buildWizardPropertiesBlob,
  gatewayAuth,
  isPastRefresh,
  isTrustedGatewayUrl,
  resetGatewaySession,
} from '@lib/gateway-session';
import type { HostResolution } from '@lib/host-resolution';
import { ErrorCodes } from '@lib/errors';
import { setLegacyGatewayFallback } from '@lib/legacy-gateway';
import { resetCiIdentity } from '@lib/ci-identity';
import { WizardError } from '@utils/wizard-abort';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';

vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn(), captureException: vi.fn() },
}));

vi.mock('@utils/debug', () => ({ logToFile: vi.fn() }));

// logToFile is variadic, so a leak in any argument is a leak. Rendered every way the
// sink might: JSON (which invokes getters and toJSON), an Error's stack, and inspect.
const renderArg = (a: unknown): string => {
  if (typeof a === 'string') return a;
  const parts = [inspect(a, { depth: null })];
  if (a instanceof Error) parts.push(a.stack ?? String(a));
  try {
    parts.push(String(JSON.stringify(a)));
  } catch {
    // Cyclic, so JSON.stringify throws and the sink falls back to inspect too.
  }
  return parts.join(' ');
};

const loggedLines = () =>
  vi.mocked(logToFile).mock.calls.map((call) => call.map(renderArg).join(' '));

const host = {
  region: 'us',
  apiHost: 'https://us.posthog.com',
} as unknown as HostResolution;

describe('gatewayAuth', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetGatewaySession();
    fetchMock.mockReset();
    vi.mocked(analytics.wizardCapture).mockClear();
    vi.mocked(logToFile).mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves auth from a mint response and caches it', async () => {
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
      teamId: 42,
      refreshAtMs: expect.any(Number),
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
    await gatewayAuth(host, 'pha_oauth', 'integration');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('records a successful mint without ever logging the token', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          token: 'phe_secret_value',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          gateway_url: 'https://gateway.us.posthog.com',
          team_id: 42,
        }),
    });

    await gatewayAuth(host, 'pha_oauth', 'integration');

    const lines = loggedLines();
    const minted = lines.filter((l) => l.includes('minted a scoped token'));
    expect(minted).toHaveLength(1);
    expect(minted[0]).toContain('program=integration');
    expect(minted[0]).toContain('team=42');
    expect(lines.join('\n')).not.toContain('phe_secret_value');
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
  ])('refuses the run on HTTP %i', async (status, fragment) => {
    fetchMock.mockResolvedValue({ ok: false, status });
    // A refusal is the mint enforcing a limit; the run must not proceed
    // without it.
    await expect(gatewayAuth(host, 'pha_oauth', 'integration')).rejects.toThrow(
      new RegExp(String(fragment), 'i'),
    );
  });

  it('shows the server detail on a refusal when it sends one', async () => {
    // The blocklist's 403 names the contact address; the fixed message would
    // tell a banned user to re-authenticate instead.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: () =>
        Promise.resolve({
          detail: 'This account is blocked. Contact wizard@posthog.com.',
        }),
    });
    await expect(gatewayAuth(host, 'pha_oauth', 'integration')).rejects.toThrow(
      'Contact wizard@posthog.com',
    );
  });

  it('keeps the fixed message when the detail is only control characters', async () => {
    // Pins both the C1 arm and the trim running after the substitution: either
    // one reverted leaves a run of spaces as the user-facing message.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ detail: '\u0007\u009b\u001b' }),
    });
    await expect(gatewayAuth(host, 'pha_oauth', 'integration')).rejects.toThrow(
      /access to this project/i,
    );
  });

  it('strips control characters before the detail reaches the terminal', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: () =>
        Promise.resolve({ detail: 'Upgrade\u001b[2J\u0007 the wizard.' }),
    });
    await expect(gatewayAuth(host, 'pha_oauth', 'integration')).rejects.toThrow(
      'Upgrade [2J  the wizard.',
    );
  });

  it.each([
    ['not an object', () => Promise.resolve('nope')],
    ['an empty detail', () => Promise.resolve({ detail: '   ' })],
    ['an unparseable body', () => Promise.reject(new SyntaxError('bad json'))],
    ['an oversized detail', () => Promise.resolve({ detail: 'x'.repeat(501) })],
  ])(
    'keeps the fixed message when the refusal body is %s',
    async (_label, json) => {
      fetchMock.mockResolvedValue({ ok: false, status: 403, json });
      await expect(
        gatewayAuth(host, 'pha_oauth', 'integration'),
      ).rejects.toThrow(/access to this project/i);
    },
  );

  it.each([
    [401, /re-authenticate with `npx @posthog\/wizard@latest`/i],
    [404, /does not issue gateway tokens/i],
  ])(
    'refuses with a status-specific message on HTTP %i',
    async (status, message) => {
      fetchMock.mockResolvedValue({ ok: false, status });
      // Neither status has a fallback: 401 is a credential the mint does not
      // accept, 404 an instance without the mint endpoint. A run that proceeded
      // past either would be on a path enforcing none of the mint's limits.
      const err: unknown = await gatewayAuth(
        host,
        'pha_oauth',
        'integration',
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(GatewayMintRefused);
      expect((err as GatewayMintRefused).status).toBe(status);
      expect((err as GatewayMintRefused).message).toMatch(message);
    },
  );

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

  it('reads the outcome from the DRF body code and shows its detail', async () => {
    // The exact shape the backend's exception handler writes for a refusal.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: () =>
        Promise.resolve({
          type: 'permission_denied',
          code: 'blocked',
          detail: 'This account is blocked. Contact wizard@posthog.com.',
          attr: null,
        }),
    });
    const err: unknown = await gatewayAuth(host, 'pha_oauth', 'audit').catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(GatewayMintRefused);
    expect((err as GatewayMintRefused).outcome).toBe('blocked');
    expect((err as GatewayMintRefused).message).toContain(
      'Contact wizard@posthog.com',
    );
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'gateway mint refused',
      { status: 403, outcome: 'blocked', program: 'audit', renewal: false },
    );
  });

  it.each([
    [
      'code wins over outcome',
      { code: 'blocked', outcome: 'throttled' },
      'blocked',
    ],
    [
      'outcome carries it when code is absent',
      { outcome: 'throttled' },
      'throttled',
    ],
    [
      'an empty code does not shadow outcome',
      { code: '  ', outcome: 'throttled' },
      'throttled',
    ],
    [
      'a control-only code does not shadow outcome',
      { code: '\u0007', outcome: 'throttled' },
      'throttled',
    ],
  ])('resolves the outcome when %s', async (_label, body, want) => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve(body),
    });
    const err: unknown = await gatewayAuth(host, 'pha_oauth', 'audit').catch(
      (e: unknown) => e,
    );
    expect((err as GatewayMintRefused).outcome).toBe(want);
  });

  it('captures a refusal with its status, outcome and program', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: () =>
        Promise.resolve({
          detail: 'This account is blocked.',
          outcome: 'blocked',
        }),
    });
    // The backend's own denial event has no run id, so this client event is
    // what joins a refusal to the session.
    const err: unknown = await gatewayAuth(host, 'pha_oauth', 'audit').catch(
      (e: unknown) => e,
    );
    expect(analytics.wizardCapture).toHaveBeenCalledTimes(1);
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'gateway mint refused',
      { status: 403, outcome: 'blocked', program: 'audit', renewal: false },
    );
    expect((err as GatewayMintRefused).outcome).toBe('blocked');
  });

  it.each([
    ['absent', () => Promise.resolve({ detail: 'Limit reached.' })],
    ['not a string', () => Promise.resolve({ outcome: 429 })],
    ['a non-string code', () => Promise.resolve({ code: 403 })],
    ['oversized', () => Promise.resolve({ outcome: 'x'.repeat(65) })],
    ['unparseable', () => Promise.reject(new SyntaxError('bad json'))],
  ])(
    'captures a refusal with no outcome when the body has one that is %s',
    async (_label, json) => {
      fetchMock.mockResolvedValue({ ok: false, status: 429, json });
      await expect(
        gatewayAuth(host, 'pha_oauth', 'integration'),
      ).rejects.toBeInstanceOf(GatewayMintRefused);
      expect(analytics.wizardCapture).toHaveBeenCalledWith(
        'gateway mint refused',
        {
          status: 429,
          outcome: undefined,
          program: 'integration',
          renewal: false,
        },
      );
    },
  );

  it('does not capture a mint failure as a refusal', async () => {
    // A 5xx is the mint being unavailable, not a decision about this run.
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await expect(
      gatewayAuth(host, 'pha_oauth', 'integration'),
    ).rejects.toBeInstanceOf(GatewayMintFailed);
    expect(analytics.wizardCapture).not.toHaveBeenCalled();
  });

  it('throws coded WizardErrors so the runners can name the failure', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ outcome: 'blocked' }),
    });
    const refused: unknown = await gatewayAuth(
      host,
      'pha_oauth',
      'integration',
    ).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(WizardError);
    expect((refused as WizardError).code).toBe(ErrorCodes.GatewayMintRefused);
    // The context is what wizardAbort attaches to the captured exception.
    expect((refused as WizardError).context).toEqual({
      status: 403,
      outcome: 'blocked',
    });

    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    const failed: unknown = await gatewayAuth(
      host,
      'pha_oauth',
      'integration',
    ).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(WizardError);
    expect((failed as WizardError).code).toBe(ErrorCodes.GatewayMintFailed);
  });

  it('surfaces a refusal through the transport catch', async () => {
    // The refusal is thrown from inside the try that wraps fetch, so a catch that
    // treats every throw as a transport failure would silently restore fallback.
    fetchMock.mockResolvedValue({ ok: false, status: 429 });
    await expect(
      gatewayAuth(host, 'pha_oauth', 'integration'),
    ).rejects.toBeInstanceOf(GatewayMintRefused);
  });

  describe('CI legacy fallback', () => {
    const refused = (status: number) => ({
      ok: false,
      status,
      json: () => Promise.resolve({}),
    });

    beforeEach(() => setLegacyGatewayFallback(true));
    afterEach(() => setLegacyGatewayFallback(false));

    it('stays on the legacy gateway when the mint does not take the credential', async () => {
      // A personal API key 401s at the mint; the legacy gateway authenticates it itself.
      fetchMock.mockResolvedValue(refused(401));
      const auth = await gatewayAuth(host, 'phx_personal', 'integration');
      expect(auth).toMatchObject({
        gatewayUrl: 'https://gateway.us.posthog.com/wizard',
        token: 'phx_personal',
        legacy: true,
      });
      expect(isPastRefresh(auth)).toBe(false);
    });

    it('picks the legacy gateway for the region, or the local one for a dev host', async () => {
      fetchMock.mockResolvedValue(refused(401));
      const urlFor = async (region: string, apiHost: string) => {
        resetGatewaySession();
        const h = { region, apiHost } as unknown as HostResolution;
        return (await gatewayAuth(h, 'phx_personal', 'integration')).gatewayUrl;
      };
      expect(await urlFor('eu', 'https://eu.i.posthog.com')).toBe(
        'https://gateway.eu.posthog.com/wizard',
      );
      expect(await urlFor('us', 'http://localhost:8010')).toBe(
        'http://localhost:3308/wizard',
      );
      expect(await urlFor('us', 'http://host.docker.internal:8010')).toBe(
        'http://host.docker.internal:3308/wizard',
      );
    });

    it('stays on the legacy gateway when the instance has no mint', async () => {
      fetchMock.mockResolvedValue(refused(404));
      const auth = await gatewayAuth(host, 'phx_personal', 'integration');
      expect(auth.legacy).toBe(true);
    });

    it('caches the fallback instead of re-asking the mint per caller', async () => {
      fetchMock.mockResolvedValue(refused(401));
      await gatewayAuth(host, 'phx_personal', 'integration');
      await gatewayAuth(host, 'phx_personal', 'integration');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('still fails a policy refusal', async () => {
      // 403/429/400 are decisions about the run, which the legacy gateway would not enforce.
      fetchMock.mockResolvedValue(refused(403));
      await expect(
        gatewayAuth(host, 'phx_personal', 'integration'),
      ).rejects.toBeInstanceOf(GatewayMintRefused);
    });

    it('still mints when the mint accepts the credential', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            token: 'phe_minted',
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
            gateway_url: 'https://gateway.us.posthog.com',
          }),
      });
      const auth = await gatewayAuth(host, 'pha_app', 'integration');
      expect(auth.token).toBe('phe_minted');
      expect(auth.legacy).toBeUndefined();
    });

    it('does not fall back outside CI', async () => {
      setLegacyGatewayFallback(false);
      fetchMock.mockResolvedValue(refused(401));
      await expect(
        gatewayAuth(host, 'phx_personal', 'integration'),
      ).rejects.toBeInstanceOf(GatewayMintRefused);
    });
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
    // has nothing to attribute the run to and refuses. The flag is what tells
    // it this build reads a refusal rather than falling back on a 404.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ program: 'audit', reads_refusal_reason: true }),
      }),
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

  it('sets the refresh instant at the refresh fraction of the token life', async () => {
    vi.useFakeTimers();
    try {
      const ttlMs = 60 * 60 * 1000;
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            token: 'phe_minted',
            expires_at: new Date(Date.now() + ttlMs).toISOString(),
            gateway_url: 'https://gateway.us.posthog.com',
          }),
      });
      const auth = await gatewayAuth(host, 'pha_oauth', 'integration');
      expect(auth.refreshAtMs).toBe(Date.now() + ttlMs * 0.8);
      // A 401 before this instant is a bad credential; after it, an aged
      // bearer that one re-mint recovers.
      expect(isPastRefresh(auth)).toBe(false);
      vi.setSystemTime(Date.now() + ttlMs * 0.8);
      expect(isPastRefresh(auth)).toBe(true);
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
      ai_product: 'wizard',
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

describe('gatewayAuth with a CI identity', () => {
  const fetchMock = vi.fn();
  const MINT_URL = 'https://us.posthog.com/api/wizard/gateway_token/';
  const REQUEST_URL =
    'https://run-actions-1-azure-eastus.actions.githubusercontent.com/abc/idtoken?api-version=2.0';
  let issued = 0;

  const minted = (ttlMs = 3600_000) => ({
    ok: true,
    json: () =>
      Promise.resolve({
        token: 'phe_ci',
        expires_at: new Date(Date.now() + ttlMs).toISOString(),
        gateway_url: 'https://ai-gateway.us.posthog.com',
      }),
  });
  const refused = { ok: false, status: 401, json: () => Promise.resolve({}) };
  const throttled = { ok: false, status: 429, json: () => Promise.resolve({}) };
  const unavailable = {
    ok: false,
    status: 503,
    json: () => Promise.resolve({}),
  };
  // GitHub answers the identity request with a new token each time; the mint
  // answers with whatever `mint` returns.
  const route = (mint: () => unknown) =>
    fetchMock.mockImplementation((url: URL | string) =>
      Promise.resolve(
        String(url).startsWith(REQUEST_URL)
          ? {
              ok: true,
              status: 200,
              json: () =>
                Promise.resolve({ value: `identity.token.${++issued}` }),
            }
          : mint(),
      ),
    );
  const mintBearers = () =>
    fetchMock.mock.calls
      .filter(([url]) => String(url) === MINT_URL)
      .map(
        ([, init]) =>
          (init as { headers: Record<string, string> }).headers.Authorization,
      );

  beforeEach(() => {
    issued = 0;
    resetGatewaySession();
    resetCiIdentity();
    fetchMock.mockReset();
    vi.mocked(logToFile).mockClear();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('WIZARD_CI_IDENTITY', 'github-actions');
    vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_URL', REQUEST_URL);
    vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'runner-request-token');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('mints with a GitHub identity token rather than the personal key', async () => {
    route(() => minted());
    const auth = await gatewayAuth(host, 'phx_personal', 'integration');
    expect(auth.token).toBe('phe_ci');
    expect(mintBearers()).toEqual(['Bearer identity.token.1']);
  });

  it('asks GitHub for a new identity token when it re-mints', async () => {
    // Identity tokens are single-use and expire in minutes, so a re-mint that
    // reused the first would be refused.
    vi.useFakeTimers({ toFake: ['Date'] });
    route(() => minted(150_000));
    await gatewayAuth(host, 'phx_personal', 'integration');
    vi.setSystemTime(Date.now() + 130_000);
    await gatewayAuth(host, 'phx_personal', 'integration');
    expect(mintBearers()).toEqual([
      'Bearer identity.token.1',
      'Bearer identity.token.2',
    ]);
  });

  it('fails the run rather than falling back when the mint refuses', async () => {
    // The refusal a broken identity path produces is a 401, which the CI
    // fallback admits for a personal key.
    setLegacyGatewayFallback(true);
    try {
      route(() => refused);
      await expect(
        gatewayAuth(host, 'phx_personal', 'integration'),
      ).rejects.toBeInstanceOf(GatewayMintRefused);
    } finally {
      setLegacyGatewayFallback(false);
    }
  });

  it('fails the run without minting when GitHub gives no identity token', async () => {
    setLegacyGatewayFallback(true);
    try {
      vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_TOKEN', '');
      route(() => minted());
      await expect(
        gatewayAuth(host, 'phx_personal', 'integration'),
      ).rejects.toBeInstanceOf(GatewayMintFailed);
      expect(mintBearers()).toEqual([]);
    } finally {
      setLegacyGatewayFallback(false);
    }
  });

  it('still lets a user run fall back on the same refusal', async () => {
    vi.stubEnv('WIZARD_CI_IDENTITY', '');
    setLegacyGatewayFallback(true);
    try {
      route(() => refused);
      const auth = await gatewayAuth(host, 'phx_personal', 'integration');
      expect(auth).toMatchObject({ token: 'phx_personal', legacy: true });
      expect(mintBearers()).toEqual(['Bearer phx_personal']);
    } finally {
      setLegacyGatewayFallback(false);
    }
  });

  it('names the identity that minted, so a CI run is separable in the log', async () => {
    route(() => minted());
    await gatewayAuth(host, 'phx_personal', 'integration');
    expect(loggedLines().join('\n')).toContain('identity=ci');
  });

  it('names a user run as a user run', async () => {
    vi.stubEnv('WIZARD_CI_IDENTITY', '');
    route(() => minted());
    await gatewayAuth(host, 'phx_personal', 'integration');
    expect(loggedLines().join('\n')).toContain('identity=user');
  });

  it('keeps a live token when a renewal fails for availability, then renews', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    let available = true;
    route(() =>
      available
        ? minted(150_000)
        : { ok: false, status: 503, json: () => Promise.resolve({}) },
    );
    const first = await gatewayAuth(host, 'phx_personal', 'integration');
    available = false;
    vi.setSystemTime(start + 130_000);
    await expect(
      gatewayAuth(host, 'phx_personal', 'integration'),
    ).resolves.toBe(first);
    available = true;
    vi.setSystemTime(start + 151_000);
    const renewed = await gatewayAuth(host, 'phx_personal', 'integration');
    expect(renewed).not.toBe(first);
    expect(mintBearers()).toHaveLength(3);
  });

  it('gives callers that join a failing renewal the live token too', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    let available = true;
    route(() => (available ? minted(150_000) : unavailable));
    const first = await gatewayAuth(host, 'phx_personal', 'integration');
    available = false;
    vi.setSystemTime(start + 130_000);
    const joined = await Promise.all([
      gatewayAuth(host, 'phx_personal', 'integration'),
      gatewayAuth(host, 'phx_personal', 'integration'),
    ]);
    expect(joined).toEqual([first, first]);
    expect(mintBearers()).toHaveLength(2);
  });

  it("never answers a failed mint for one program with another program's token", async () => {
    let available = true;
    route(() => (available ? minted() : unavailable));
    await gatewayAuth(host, 'phx_personal', 'integration');
    available = false;
    await expect(
      gatewayAuth(host, 'phx_personal', 'warehouse'),
    ).rejects.toThrow();
  });

  it('stops serving a kept token once it expires', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    let available = true;
    route(() => (available ? minted(150_000) : unavailable));
    await gatewayAuth(host, 'phx_personal', 'integration');
    available = false;
    vi.setSystemTime(start + 151_000);
    await expect(
      gatewayAuth(host, 'phx_personal', 'integration'),
    ).rejects.toThrow();
  });

  it('doubles the wait between failed renewals and stops after three retries', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    let available = true;
    route(() => (available ? minted(7_200_000) : unavailable));
    const first = await gatewayAuth(host, 'phx_personal', 'integration');
    available = false;
    const at = async (seconds: number, mints: number) => {
      vi.setSystemTime(start + seconds * 1000);
      const auth = await gatewayAuth(host, 'phx_personal', 'integration');
      expect(mintBearers()).toHaveLength(mints);
      return auth;
    };
    // Stale at 5760s. The waits are 60s, 120s and 240s, probed a second either side.
    await at(5800, 2);
    await at(5859, 2);
    await at(5860, 3);
    await at(5979, 3);
    await at(5980, 4);
    await at(6219, 4);
    await at(6220, 5);
    await expect(at(7199, 5)).resolves.toBe(first);
    vi.setSystemTime(start + 7_200_000);
    await expect(
      gatewayAuth(host, 'phx_personal', 'integration'),
    ).rejects.toThrow();
    expect(mintBearers()).toHaveLength(6);
  });

  it('starts the retry count again after a renewal succeeds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    let available = true;
    route(() => (available ? minted(7_200_000) : unavailable));
    await gatewayAuth(host, 'phx_personal', 'integration');
    const at = (seconds: number) => {
      vi.setSystemTime(start + seconds * 1000);
      return gatewayAuth(host, 'phx_personal', 'integration');
    };
    available = false;
    await at(5800);
    available = true;
    const renewed = await at(5860);
    available = false;
    // The renewed token is stale at 11620s, and its first failure waits 60s again.
    await at(11620);
    await expect(at(11679)).resolves.toBe(renewed);
    expect(mintBearers()).toHaveLength(4);
    await at(11680);
    expect(mintBearers()).toHaveLength(5);
  });

  it('keeps a live token when a renewal is throttled', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    let throttle = false;
    route(() => (throttle ? throttled : minted(150_000)));
    const first = await gatewayAuth(host, 'phx_personal', 'integration');
    throttle = true;
    vi.setSystemTime(start + 130_000);
    await expect(
      gatewayAuth(host, 'phx_personal', 'integration'),
    ).resolves.toBe(first);
  });

  it('marks a throttled renewal in the refusal event, since the run goes on', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    let throttle = false;
    route(() => (throttle ? throttled : minted(150_000)));
    await gatewayAuth(host, 'phx_personal', 'integration');
    vi.mocked(analytics.wizardCapture).mockClear();
    throttle = true;
    vi.setSystemTime(start + 130_000);
    await gatewayAuth(host, 'phx_personal', 'integration');
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'gateway mint refused',
      {
        status: 429,
        outcome: undefined,
        program: 'integration',
        renewal: true,
      },
    );
  });

  it.each([400, 401, 403, 404])(
    'still ends the run when a renewal is refused with %i',
    async (status) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const start = Date.now();
      let refuse = false;
      route(() =>
        refuse
          ? { ok: false, status, json: () => Promise.resolve({}) }
          : minted(150_000),
      );
      await gatewayAuth(host, 'phx_personal', 'integration');
      refuse = true;
      vi.setSystemTime(start + 130_000);
      await expect(
        gatewayAuth(host, 'phx_personal', 'integration'),
      ).rejects.toBeInstanceOf(GatewayMintRefused);
    },
  );

  it('fails the run on an unknown opt-in value instead of using the personal key', async () => {
    vi.stubEnv('WIZARD_CI_IDENTITY', 'github');
    setLegacyGatewayFallback(true);
    try {
      route(() => refused);
      await expect(
        gatewayAuth(host, 'phx_personal', 'integration'),
      ).rejects.toBeInstanceOf(GatewayMintFailed);
      expect(mintBearers()).toEqual([]);
    } finally {
      setLegacyGatewayFallback(false);
    }
  });

  it('never writes the identity token or the request token to the log', async () => {
    route(() => refused);
    await gatewayAuth(host, 'phx_personal', 'integration').catch(
      () => undefined,
    );
    const logged = loggedLines().join('\n');
    expect(logged).not.toContain('identity.token');
    expect(logged).not.toContain('runner-request-token');
  });
});
