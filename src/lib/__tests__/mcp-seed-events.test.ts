import {
  buildSeedEvents,
  tallySeedEvents,
  seededProfile,
} from '@lib/mcp-seed-events';
import {
  degradedProfile,
  type ProjectDataProfile,
} from '@lib/mcp-project-profile';

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
