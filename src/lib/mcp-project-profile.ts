/**
 * Project data profile — a cheap, best-effort "scout" of what a user's
 * PostHog project actually contains. Run once after auth, before the MCP
 * tutorial picker, so the tutorial can adapt to the terrain instead of
 * offering prompts that hit a data-less dead end (the failure mode where
 * a freshly-installed project has no events and the agent narrates
 * emptiness because it was told this is a demo).
 *
 * The profile drives three data-aware behaviours in the tutorial:
 *   • tier        empty → offer to seed demo events; sparse/rich → go
 *                 straight to quests.
 *   • topEvents   quests are generated from the project's REAL event names
 *                 (e.g. a funnel between the two busiest custom events),
 *                 never from a generic hardcoded list.
 *   • products    a product with no data becomes an "enable X" cross-sell
 *                 (which routes through docs-search and always returns
 *                 something) instead of a read that comes back empty.
 *
 * Every probe is best-effort and time-boxed: a slow or failing call
 * resolves to a conservative fallback rather than throwing. The tutorial
 * must never be blocked, slowed, or broken by the scout — a degraded
 * profile (`degraded: true`) simply falls back to the static role kit and
 * skips activation cross-sells (we only nag the user to "enable X" when
 * we are CONFIDENT X is absent).
 */

import axios from 'axios';
import { WIZARD_USER_AGENT } from './constants';
import { logToFile } from '@utils/debug';

// Time-box every probe call. The scout sits on the critical path between
// auth and the picker, so a wedged endpoint must not stall the tutorial.
const PROBE_TIMEOUT_MS = 5000;
// Below this 30-day event count a project is "sparse": real data exists
// but not enough to build confident multi-step funnels from.
const SPARSE_EVENT_THRESHOLD = 50;
// How many event names to pull. Enough to find usable custom events for
// quest generation without bloating the response.
const TOP_EVENTS_LIMIT = 25;
// Probe window. Matches the tutorial's default "last 30 days" framing.
const PROBE_WINDOW_DAYS = 30;

/**
 * Non-`$`-prefixed events that are still PostHog system noise, so they
 * don't get templated into quests as if they were product events.
 */
const NON_DOLLAR_SYSTEM_EVENTS = new Set([
  'survey sent',
  'survey shown',
  'survey dismissed',
]);

export type DataTier = 'empty' | 'sparse' | 'rich';

export interface EventVolume {
  /** Raw event name as stored in PostHog (e.g. "$pageview", "checkout_started"). */
  name: string;
  count: number;
}

/**
 * Which PostHog products have data in the project. Drives activation
 * cross-sells: a `false` here means "offer to help the user turn this on"
 * rather than "run a read that returns nothing". Conservative by design —
 * a field is only `false` when a probe ran cleanly and found nothing; an
 * unknown (failed/timed-out probe) defaults to `true` so we never nag a
 * user to enable something they already have.
 */
export interface ProductPresence {
  /** `$pageview` events seen → web analytics is live. */
  webAnalytics: boolean;
  /** `$exception` events seen → error tracking is live. */
  errorTracking: boolean;
  sessionReplay: boolean;
  surveys: boolean;
  featureFlags: boolean;
  experiments: boolean;
  dataWarehouse: boolean;
}

export interface ProjectDataProfile {
  tier: DataTier;
  /** Total event volume over the probe window (last 30 days). */
  totalEvents: number;
  /** Number of distinct event names seen in the window. */
  distinctEventCount: number;
  /** Top events by volume (system + custom), most-frequent first. */
  topEvents: EventVolume[];
  /** Top *custom* events (system noise stripped) — what quests are built from. */
  topCustomEvents: EventVolume[];
  products: ProductPresence;
  /** True when produced by seeding rather than a live probe. */
  seeded: boolean;
  /** True when the probe failed/timed out and this is a safe fallback. */
  degraded: boolean;
}

/** Every product assumed present — the safe "don't nag" default. */
const ALL_PRODUCTS_PRESENT: ProductPresence = {
  webAnalytics: true,
  errorTracking: true,
  sessionReplay: true,
  surveys: true,
  featureFlags: true,
  experiments: true,
  dataWarehouse: true,
};

/**
 * Conservative fallback used when the core events probe fails. Tier is
 * `sparse` (not `empty`) so we neither offer to seed a project we can't
 * confirm is empty nor claim it's rich; `degraded` tells consumers to use
 * the static role kit and skip activation cross-sells.
 */
export function degradedProfile(): ProjectDataProfile {
  return {
    tier: 'sparse',
    totalEvents: 0,
    distinctEventCount: 0,
    topEvents: [],
    topCustomEvents: [],
    products: { ...ALL_PRODUCTS_PRESENT },
    seeded: false,
    degraded: true,
  };
}

/** Is this event name PostHog system noise rather than a product event? */
function isSystemEvent(name: string): boolean {
  return name.startsWith('$') || NON_DOLLAR_SYSTEM_EVENTS.has(name);
}

/**
 * Pure profile assembler — turns raw probe outputs into a classified
 * profile. Exported so tier classification, custom-event filtering, and
 * product derivation can be unit-tested without touching the network.
 *
 * `rest` carries the REST existence checks; a `null` entry means the
 * check was inconclusive (failed/timed out) and the product defaults to
 * present so we never nag the user to enable it.
 */
export function assembleProfile(
  topEvents: EventVolume[],
  rest: {
    sessionReplay: boolean | null;
    surveys: boolean | null;
    featureFlags: boolean | null;
    experiments: boolean | null;
    dataWarehouse: boolean | null;
  },
  opts?: { seeded?: boolean },
): ProjectDataProfile {
  const totalEvents = topEvents.reduce((sum, e) => sum + e.count, 0);
  const distinctEventCount = topEvents.length;
  const topCustomEvents = topEvents.filter((e) => !isSystemEvent(e.name));

  const has = (name: string): boolean =>
    topEvents.some((e) => e.name === name && e.count > 0);

  let tier: DataTier;
  if (totalEvents === 0) {
    tier = 'empty';
  } else if (totalEvents < SPARSE_EVENT_THRESHOLD || distinctEventCount < 2) {
    tier = 'sparse';
  } else {
    tier = 'rich';
  }

  return {
    tier,
    totalEvents,
    distinctEventCount,
    topEvents,
    topCustomEvents,
    products: {
      // Event-derived: an empty 30-day window for these events strongly
      // implies the product isn't wired up.
      webAnalytics: has('$pageview'),
      errorTracking: has('$exception'),
      // REST-derived: null (inconclusive) defaults to present.
      sessionReplay: rest.sessionReplay ?? true,
      surveys: rest.surveys ?? true,
      featureFlags: rest.featureFlags ?? true,
      experiments: rest.experiments ?? true,
      dataWarehouse: rest.dataWarehouse ?? true,
    },
    seeded: opts?.seeded ?? false,
    degraded: false,
  };
}

/**
 * Run a single HogQL query returning the top events by volume in the
 * probe window. Throws on any failure — the caller degrades the whole
 * profile when the core events probe can't run.
 */
async function queryTopEvents(
  accessToken: string,
  projectId: number,
  baseUrl: string,
): Promise<EventVolume[]> {
  const url = `${baseUrl}/api/projects/${projectId}/query/`;
  const response = await axios.post(
    url,
    {
      query: {
        kind: 'HogQLQuery',
        query: `SELECT event, count() AS c FROM events WHERE timestamp > now() - INTERVAL ${PROBE_WINDOW_DAYS} DAY GROUP BY event ORDER BY c DESC LIMIT ${TOP_EVENTS_LIMIT}`,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': WIZARD_USER_AGENT,
        'Content-Type': 'application/json',
      },
      timeout: PROBE_TIMEOUT_MS,
    },
  );

  // HogQL responses are `{ results: [[event, count], ...], columns: [...] }`.
  const rows: unknown = (response.data as { results?: unknown })?.results;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row): EventVolume | null => {
      if (!Array.isArray(row)) return null;
      const name = String(row[0] ?? '');
      const count = Number(row[1] ?? 0);
      if (!name || !Number.isFinite(count)) return null;
      return { name, count };
    })
    .filter((e): e is EventVolume => e !== null);
}

/**
 * Best-effort existence check against a list endpoint. Resolves to:
 *   true   — at least one row exists
 *   false  — endpoint returned a clean empty list
 *   null   — inconclusive (error, timeout, unexpected shape)
 * Never throws; `null` lets the assembler default the product to present.
 */
async function restExists(
  accessToken: string,
  projectId: number,
  baseUrl: string,
  resource: string,
): Promise<boolean | null> {
  try {
    const response = await axios.get(
      `${baseUrl}/api/projects/${projectId}/${resource}/`,
      {
        params: { limit: 1 },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': WIZARD_USER_AGENT,
        },
        timeout: PROBE_TIMEOUT_MS,
      },
    );
    const results: unknown = (response.data as { results?: unknown })?.results;
    if (!Array.isArray(results)) return null;
    return results.length > 0;
  } catch {
    return null;
  }
}

/**
 * Scout a project: one HogQL query for event volume + event names, plus a
 * handful of parallel REST existence checks for products that aren't
 * derivable from the event stream. Always resolves — returns a degraded
 * profile if the core events query fails.
 */
export async function probeProjectData(args: {
  accessToken: string;
  projectId: number;
  /** App host, e.g. https://us.posthog.com. */
  host: string;
}): Promise<ProjectDataProfile> {
  const { accessToken, projectId, host } = args;
  const baseUrl = host.replace(/\/$/, '');

  try {
    const [
      events,
      sessionReplay,
      surveys,
      featureFlags,
      experiments,
      warehouse,
    ] = await Promise.all([
      queryTopEvents(accessToken, projectId, baseUrl),
      restExists(accessToken, projectId, baseUrl, 'session_recordings'),
      restExists(accessToken, projectId, baseUrl, 'surveys'),
      restExists(accessToken, projectId, baseUrl, 'feature_flags'),
      restExists(accessToken, projectId, baseUrl, 'experiments'),
      restExists(accessToken, projectId, baseUrl, 'warehouse_tables'),
    ]);

    const profile = assembleProfile(events, {
      sessionReplay,
      surveys,
      featureFlags,
      experiments,
      dataWarehouse: warehouse,
    });
    logToFile(
      `[probeProjectData] tier=${profile.tier} totalEvents=${profile.totalEvents} distinct=${profile.distinctEventCount} custom=${profile.topCustomEvents.length}`,
    );
    return profile;
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    logToFile(`[probeProjectData] degraded — probe failed: ${text}`);
    return degradedProfile();
  }
}
