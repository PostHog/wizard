import { CaptureError } from 'posthog-node';
import {
  buildSeedEvents,
  seedDemoEvents,
  tallySeedEvents,
  seededProfile,
} from '../seed-events';
import {
  degradedProfile,
  type ProjectDataProfile,
} from '../mcp-project-profile';

const NOW = new Date('2026-06-08T12:00:00.000Z');
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe('buildSeedEvents', () => {
  const events = buildSeedEvents(NOW);

  it('is deterministic for a fixed clock', () => {
    expect(buildSeedEvents(NOW)).toEqual(events);
  });

  it('backdates every event within the last 7 days', () => {
    for (const e of events) {
      const age = NOW.getTime() - e.timestamp.getTime();
      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThan(SEVEN_DAYS_MS);
    }
  });

  it('tags every event as wizard_seed for later cleanup', () => {
    expect(events.every((e) => e.properties.wizard_seed === true)).toBe(true);
  });

  it('uses only synthetic demo distinct ids', () => {
    expect(
      events.every((e) => e.distinctId.startsWith('wizard-demo-user-')),
    ).toBe(true);
  });

  it('produces the funnel event set and no $exception', () => {
    const names = new Set(events.map((e) => e.event));
    expect(names).toEqual(
      new Set([
        '$pageview',
        'signed_up',
        'activated',
        'feature_used',
        'upgraded_to_paid',
      ]),
    );
    // Error tracking is left empty on purpose (stays an activation cross-sell).
    expect(names.has('$exception')).toBe(false);
  });

  it('models funnel drop-off (each step has fewer or equal events)', () => {
    const counts = Object.fromEntries(
      tallySeedEvents(events).map((e) => [e.name, e.count]),
    );
    expect(counts['signed_up']).toBeGreaterThan(counts['activated']);
    expect(counts['activated']).toBeGreaterThan(counts['upgraded_to_paid']);
  });
});

describe('tallySeedEvents', () => {
  it('sorts by volume descending with $pageview on top', () => {
    const tally = tallySeedEvents(buildSeedEvents(NOW));
    expect(tally[0].name).toBe('$pageview');
    for (let i = 1; i < tally.length; i++) {
      expect(tally[i - 1].count).toBeGreaterThanOrEqual(tally[i].count);
    }
  });
});

describe('seededProfile', () => {
  it('produces a rich, seeded profile with web analytics on and errors off', () => {
    const base = degradedProfile();
    const p = seededProfile(base, NOW);
    expect(p.tier).toBe('rich');
    expect(p.seeded).toBe(true);
    expect(p.degraded).toBe(false);
    expect(p.products.webAnalytics).toBe(true);
    expect(p.products.errorTracking).toBe(false);
  });

  it('exposes the funnel events as custom events for quest generation', () => {
    const p = seededProfile(degradedProfile(), NOW);
    const customNames = p.topCustomEvents.map((e) => e.name);
    expect(customNames).toEqual(
      expect.arrayContaining([
        'signed_up',
        'activated',
        'feature_used',
        'upgraded_to_paid',
      ]),
    );
    expect(customNames).not.toContain('$pageview');
  });

  it('carries forward REST product presence from the pre-seed probe', () => {
    // A pre-seed project that already had surveys + flags but no replay.
    const base: ProjectDataProfile = {
      ...degradedProfile(),
      products: {
        webAnalytics: false,
        errorTracking: false,
        sessionReplay: false,
        surveys: true,
        featureFlags: true,
        experiments: false,
        dataWarehouse: false,
      },
    };
    const p = seededProfile(base, NOW);
    expect(p.products.surveys).toBe(true);
    expect(p.products.featureFlags).toBe(true);
    expect(p.products.sessionReplay).toBe(false);
    expect(p.products.experiments).toBe(false);
  });
});

describe('seedDemoEvents', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const baseArgs = {
    projectApiKey: 'phc_test_key',
    apiHost: 'https://us.i.posthog.com',
    baseProfile: degradedProfile(),
    now: NOW,
  };

  it('sends the demo batch to capture v1 and resolves with the seeded profile', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"results":{}}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const profile = await seedDemoEvents(baseArgs);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://us.i.posthog.com/i/v1/analytics/events',
    );
    expect(profile.seeded).toBe(true);
    expect(profile.tier).toBe('rich');
  });

  it('rejects with CaptureError on HTTP 400 delivery failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('bad request', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(seedDemoEvents(baseArgs)).rejects.toBeInstanceOf(CaptureError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects with CaptureError preserving network cause and drains once', async () => {
    const netErr = Object.assign(new TypeError('fetch failed'), {
      code: 'ECONNREFUSED',
    });
    const fetchMock = vi.fn().mockRejectedValue(netErr);
    vi.stubGlobal('fetch', fetchMock);

    const caught = await seedDemoEvents(baseArgs).catch((err) => err);

    expect(caught).toBeInstanceOf(CaptureError);
    expect(caught.cause).toBe(netErr);
    // 1 initial attempt + 3 default retries = 4 (single shutdown drain, not 8).
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('aborts in-flight seeding when signal fires', async () => {
    const ac = new AbortController();
    const fetchMock = vi.fn(
      (_url: unknown, init?: Parameters<typeof fetch>[1]) => {
        ac.abort();
        return Promise.reject(
          init?.signal?.reason ?? new DOMException('Aborted', 'AbortError'),
        );
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      seedDemoEvents({ ...baseArgs, signal: ac.signal }),
    ).rejects.toThrow('Seeding aborted');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
