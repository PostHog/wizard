import {
  assembleProfile,
  degradedProfile,
  type EventVolume,
} from '@lib/mcp-project-profile';

// Inconclusive REST result for every product — the "we couldn't tell"
// default used by most tier/event tests so they isolate the events probe.
const REST_UNKNOWN = {
  sessionReplay: null,
  surveys: null,
  featureFlags: null,
  experiments: null,
  dataWarehouse: null,
};

const ev = (name: string, count: number): EventVolume => ({ name, count });

describe('assembleProfile — tier classification', () => {
  it('classifies a zero-event project as empty', () => {
    const p = assembleProfile([], REST_UNKNOWN);
    expect(p.tier).toBe('empty');
    expect(p.totalEvents).toBe(0);
    expect(p.distinctEventCount).toBe(0);
  });

  it('classifies low-volume data as sparse', () => {
    const p = assembleProfile(
      [ev('$pageview', 10), ev('clicked', 5)],
      REST_UNKNOWN,
    );
    expect(p.tier).toBe('sparse');
    expect(p.totalEvents).toBe(15);
  });

  it('classifies a single high-volume event as sparse (too few distinct)', () => {
    // Over the volume threshold but only one event type — not enough
    // variety to build a confident funnel from.
    const p = assembleProfile([ev('$pageview', 5000)], REST_UNKNOWN);
    expect(p.tier).toBe('sparse');
  });

  it('classifies varied high-volume data as rich', () => {
    const p = assembleProfile(
      [
        ev('$pageview', 4000),
        ev('checkout_started', 800),
        ev('checkout_completed', 200),
      ],
      REST_UNKNOWN,
    );
    expect(p.tier).toBe('rich');
    expect(p.totalEvents).toBe(5000);
    expect(p.distinctEventCount).toBe(3);
  });
});

describe('assembleProfile — custom-event filtering', () => {
  it('strips $-prefixed system events from topCustomEvents', () => {
    const p = assembleProfile(
      [ev('$pageview', 100), ev('$autocapture', 80), ev('signed_up', 20)],
      REST_UNKNOWN,
    );
    expect(p.topCustomEvents.map((e) => e.name)).toEqual(['signed_up']);
    // topEvents keeps everything for product detection.
    expect(p.topEvents).toHaveLength(3);
  });

  it('strips non-$ PostHog system events (survey sent/shown/dismissed)', () => {
    const p = assembleProfile(
      [ev('survey shown', 50), ev('survey sent', 30), ev('purchase', 10)],
      REST_UNKNOWN,
    );
    expect(p.topCustomEvents.map((e) => e.name)).toEqual(['purchase']);
  });

  it('preserves volume order in topCustomEvents', () => {
    const p = assembleProfile(
      [ev('b_event', 100), ev('$pageview', 90), ev('a_event', 80)],
      REST_UNKNOWN,
    );
    expect(p.topCustomEvents.map((e) => e.name)).toEqual([
      'b_event',
      'a_event',
    ]);
  });
});

describe('assembleProfile — product presence', () => {
  it('derives webAnalytics/errorTracking from event presence', () => {
    const p = assembleProfile(
      [ev('$pageview', 100), ev('$exception', 5)],
      REST_UNKNOWN,
    );
    expect(p.products.webAnalytics).toBe(true);
    expect(p.products.errorTracking).toBe(true);
  });

  it('marks event-derived products absent when their events are missing', () => {
    const p = assembleProfile([ev('custom_event', 100)], REST_UNKNOWN);
    expect(p.products.webAnalytics).toBe(false);
    expect(p.products.errorTracking).toBe(false);
  });

  it('defaults REST products to present when inconclusive (null)', () => {
    const p = assembleProfile([ev('$pageview', 100)], REST_UNKNOWN);
    expect(p.products.sessionReplay).toBe(true);
    expect(p.products.surveys).toBe(true);
    expect(p.products.featureFlags).toBe(true);
    expect(p.products.experiments).toBe(true);
    expect(p.products.dataWarehouse).toBe(true);
  });

  it('marks REST products absent only on a clean empty result (false)', () => {
    const p = assembleProfile([ev('$pageview', 100)], {
      sessionReplay: false,
      surveys: false,
      featureFlags: true,
      experiments: null,
      dataWarehouse: false,
    });
    expect(p.products.sessionReplay).toBe(false);
    expect(p.products.surveys).toBe(false);
    expect(p.products.featureFlags).toBe(true);
    expect(p.products.experiments).toBe(true); // null → present
    expect(p.products.dataWarehouse).toBe(false);
  });
});

describe('assembleProfile — flags', () => {
  it('is not degraded and not seeded by default', () => {
    const p = assembleProfile([ev('$pageview', 100)], REST_UNKNOWN);
    expect(p.degraded).toBe(false);
    expect(p.seeded).toBe(false);
  });

  it('marks seeded when told', () => {
    const p = assembleProfile([ev('$pageview', 100)], REST_UNKNOWN, {
      seeded: true,
    });
    expect(p.seeded).toBe(true);
  });
});

describe('degradedProfile', () => {
  it('is sparse, degraded, and assumes every product present', () => {
    const p = degradedProfile();
    expect(p.tier).toBe('sparse');
    expect(p.degraded).toBe(true);
    expect(p.seeded).toBe(false);
    // Never nag a user to enable something when we could not probe.
    expect(Object.values(p.products).every((v) => v === true)).toBe(true);
  });
});
