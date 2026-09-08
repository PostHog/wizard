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

const host = { apiHost: 'https://us.posthog.com' } as unknown as HostResolution;

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
      { status: 403, outcome: 'blocked', program: 'audit' },
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
      { status: 403, outcome: 'blocked', program: 'audit' },
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
        { status: 429, outcome: undefined, program: 'integration' },
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
