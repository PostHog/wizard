/**
 * Demo-event seeder for the MCP tutorial's empty-project path.
 *
 * When the scout (`probeProjectData`) finds a project with zero events, the
 * tutorial offers to send a small, coherent demo dataset so the read
 * quests have something real to chew on instead of dead-ending. The
 * dataset is a recognizable SaaS product funnel —
 *
 *   $pageview → signed_up → activated → feature_used → upgraded_to_paid
 *
 * — spread across ~12 synthetic users and backdated over the last 7 days,
 * so time-windowed funnels and trends include the data the moment it lands
 * (sidestepping ingestion lag for the queries the tutorial actually runs).
 *
 * Every seeded event carries `wizard_seed: true` and a synthetic
 * `wizard-demo-user-*` distinct id, so the user can find and clean up the
 * demo data from a single search in PostHog — the same "leave a trail"
 * principle as the `(wizard MCP tutorial)` artifact tagging.
 *
 * `$exception` is deliberately NOT seeded: leaving error tracking empty
 * keeps it available as an "enable error tracking" activation cross-sell,
 * which is exactly the kind of product-discovery beat the empty path is
 * meant to create.
 */

import { getIngestionHostFromHost } from '@utils/urls';
import { logToFile } from '@utils/debug';
import {
  assembleProfile,
  type EventVolume,
  type ProjectDataProfile,
} from './mcp-project-profile';

export interface SeedEvent {
  event: string;
  distinctId: string;
  timestamp: Date;
  properties: Record<string, unknown>;
}

const SEED_USER_COUNT = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

const demoUser = (i: number): string => `wizard-demo-user-${i + 1}`;

/**
 * A timestamp `daysAgo` days plus `hour` hours BEFORE `now`. Both offsets
 * are subtracted so every seeded event lands strictly in the past (daysAgo
 * maxes at 6 and hour at ~15, keeping the oldest event under the 7-day
 * window the tutorial's queries use).
 */
const at = (now: Date, daysAgo: number, hour: number): Date =>
  new Date(now.getTime() - daysAgo * DAY_MS - hour * 60 * 60 * 1000);

/**
 * Build the deterministic demo dataset. Deterministic (no randomness) so
 * the returned profile counts always match what was sent and tests are
 * stable. Drop-off down the funnel is modelled by fewer users reaching
 * each step.
 */
export function buildSeedEvents(now: Date): SeedEvent[] {
  const events: SeedEvent[] = [];
  const push = (
    event: string,
    userIdx: number,
    daysAgo: number,
    hour: number,
    properties: Record<string, unknown> = {},
  ): void => {
    events.push({
      event,
      distinctId: demoUser(userIdx),
      timestamp: at(now, daysAgo, hour),
      properties: { ...properties, wizard_seed: true },
    });
  };

  // Pageviews: every user, a few visits spread across the week.
  const PAGES = ['/', '/pricing', '/signup', '/app'];
  for (let i = 0; i < SEED_USER_COUNT; i++) {
    for (let k = 0; k < 4; k++) {
      push('$pageview', i, (i + k) % 7, 9 + k, {
        $current_url: `https://example.com${PAGES[k % PAGES.length]}`,
      });
    }
  }

  // signed_up: 10 of 12 users (2 bounce before signing up).
  for (let i = 0; i < 10; i++) {
    push('signed_up', i, 6 - (i % 7), 10, {
      source: i % 2 ? 'organic' : 'ads',
    });
  }

  // activated: 7 of the 10 who signed up.
  for (let i = 0; i < 7; i++) {
    push('activated', i, 5 - (i % 6), 11);
  }

  // feature_used: the 7 activated users exercise features a few times each.
  const FEATURES = ['dashboards', 'insights', 'session_replay'];
  for (let i = 0; i < 7; i++) {
    for (let k = 0; k < 3; k++) {
      push('feature_used', i, 4 - ((i + k) % 5), 12 + k, {
        feature: FEATURES[k % FEATURES.length],
      });
    }
  }

  // upgraded_to_paid: 3 of the activated users convert.
  for (let i = 0; i < 3; i++) {
    push('upgraded_to_paid', i, 2 - (i % 3), 13, { plan: 'pro' });
  }

  return events;
}

/** Tally a seed-event list into volume-sorted `EventVolume[]`. */
export function tallySeedEvents(events: SeedEvent[]): EventVolume[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    counts.set(e.event, (counts.get(e.event) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * The profile a successful seed produces, without sending anything.
 * Event-derived fields come from the demo dataset; REST-derived product
 * presence is carried forward from the pre-seed probe (so a project that
 * already had, say, feature flags defined keeps that signal). Exported so
 * the screen can preview the seeded state and tests can assert on it.
 */
export function seededProfile(
  baseProfile: ProjectDataProfile,
  now: Date,
): ProjectDataProfile {
  const counts = tallySeedEvents(buildSeedEvents(now));
  return assembleProfile(
    counts,
    {
      sessionReplay: baseProfile.products.sessionReplay,
      surveys: baseProfile.products.surveys,
      featureFlags: baseProfile.products.featureFlags,
      experiments: baseProfile.products.experiments,
      dataWarehouse: baseProfile.products.dataWarehouse,
    },
    { seeded: true },
  );
}

/**
 * Send the demo dataset to the project's ingestion endpoint via
 * posthog-node, then resolve with the seeded profile. Throws if the send
 * fails so the caller can surface a soft error and fall back to the
 * write-only empty path.
 */
export async function seedDemoEvents(args: {
  /** Public project API key (write key) — the SDK's ingestion credential. */
  projectApiKey: string;
  /** App host, e.g. https://us.posthog.com; mapped to the ingestion host. */
  host: string;
  /** The pre-seed probe result; its REST product flags are carried forward. */
  baseProfile: ProjectDataProfile;
  signal?: AbortSignal;
  /** Injectable clock for deterministic tests. */
  now?: Date;
}): Promise<ProjectDataProfile> {
  const { projectApiKey, host, baseProfile, signal } = args;
  const now = args.now ?? new Date();

  if (signal?.aborted) throw new Error('Seeding aborted');

  const events = buildSeedEvents(now);
  const ingestionHost = getIngestionHostFromHost(host);
  logToFile(
    `[seedDemoEvents] sending ${events.length} demo events to ${ingestionHost}`,
  );

  const { PostHog } = await import('posthog-node');
  const client = new PostHog(projectApiKey, {
    host: ingestionHost,
    // Send everything in one batch on shutdown; no background timer.
    flushAt: events.length,
    flushInterval: 0,
    disableGeoip: true,
  });

  try {
    for (const e of events) {
      client.capture({
        distinctId: e.distinctId,
        event: e.event,
        properties: e.properties,
        timestamp: e.timestamp,
      });
    }
    // shutdown() flushes any queued events and waits for delivery.
    await client.shutdown();
  } catch (err) {
    // Best-effort teardown so we don't leak a flush timer on failure.
    try {
      await client.shutdown();
    } catch {
      /* already failing — swallow */
    }
    throw err;
  }

  if (signal?.aborted) throw new Error('Seeding aborted');

  return seededProfile(baseProfile, now);
}
