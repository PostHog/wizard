import axios from 'axios';
import { IS_DEV, WIZARD_USER_AGENT } from '@lib/constants';
import type { CloudRegion } from './types';

/**
 * Resolve a pinned PostHog base URL from an optional override. When present, it
 * becomes the single source of truth for every PostHog origin — the
 * API/ingestion host, the cloud/app URL, and the OAuth server — bypassing
 * region resolution entirely.
 *
 * The override lives on the session (`session.baseUrl`, set by `--base-url`) and
 * is threaded in by callers, so there is no hidden module-level state. A `--base-url`
 * value wins; otherwise a dev/test build implies `localhost:8010`; otherwise the
 * result is `undefined`, meaning region-based resolution applies.
 *
 * This is the runtime equivalent of the `IS_DEV` localhost routing: `IS_DEV` is a
 * build-time constant that tsdown compiles out of production builds, so it can't
 * point a shipped wizard at a local stack — `--base-url` can. Both feed this one
 * resolver so every URL helper only asks the question once.
 */
export const resolveBaseUrl = (override?: string): string | undefined => {
  return override?.trim() || (IS_DEV ? 'http://localhost:8010' : undefined);
};

export const getUiHostFromHost = (host: string) => {
  if (host.includes('us.i.posthog.com')) {
    return 'https://us.posthog.com';
  }

  if (host.includes('eu.i.posthog.com')) {
    return 'https://eu.posthog.com';
  }

  return host;
};

export const getHost = (region: CloudRegion, baseUrl?: string) => {
  const override = resolveBaseUrl(baseUrl);
  if (override) {
    return override;
  }

  if (region === 'eu') {
    return 'https://eu.i.posthog.com';
  }

  return 'https://us.i.posthog.com';
};

export const getCloudUrl = (region: CloudRegion, baseUrl?: string) => {
  const override = resolveBaseUrl(baseUrl);
  if (override) {
    return override;
  }

  if (region === 'eu') {
    return 'https://eu.posthog.com';
  }

  return 'https://us.posthog.com';
};

export async function detectRegion(
  accessToken: string,
  baseUrl?: string,
): Promise<CloudRegion> {
  // With a pinned base URL there is only one instance to talk to — skip the
  // us/eu probe and default the region label to 'us'. (Covers IS_DEV too, via
  // resolveBaseUrl.) The URLs themselves come from the override, not this label.
  if (resolveBaseUrl(baseUrl)) {
    return 'us';
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': WIZARD_USER_AGENT,
  };

  const [usResult, euResult] = await Promise.allSettled([
    axios.get('https://us.posthog.com/api/users/@me/', { headers }),
    axios.get('https://eu.posthog.com/api/users/@me/', { headers }),
  ]);

  if (usResult.status === 'fulfilled') return 'us';
  if (euResult.status === 'fulfilled') return 'eu';

  throw new Error(
    'Could not determine cloud region from access token. Please check your PostHog account.',
  );
}

export const getLlmGatewayUrl = (host: string) => {
  if (host.includes('host.docker.internal')) {
    return 'http://host.docker.internal:3308/wizard';
  }

  if (host.includes('localhost')) {
    return 'http://localhost:3308/wizard';
  }

  if (host.includes('eu.posthog.com') || host.includes('eu.i.posthog.com')) {
    return 'https://gateway.eu.posthog.com/wizard';
  }

  return 'https://gateway.us.posthog.com/wizard';
};

/** Region-agnostic prod OAuth server. Resolves to the right region server-side. */
const PROD_OAUTH_URL = 'https://oauth.posthog.com';

/**
 * OAuth server URL. Follows the base-URL override (and thus IS_DEV → localhost),
 * otherwise the region-agnostic prod OAuth host.
 */
export const getOAuthUrl = (baseUrl?: string): string =>
  resolveBaseUrl(baseUrl) ?? PROD_OAUTH_URL;
