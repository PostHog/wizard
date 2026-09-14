import axios from 'axios';
import { handleApiError } from '@lib/api';
import { WIZARD_USER_AGENT } from '@lib/constants';
import { analytics } from '@utils/analytics';
import { FeatureFlagListResponseSchema, type FeatureFlag } from './types.js';

const PAGE_LIMIT = 300;

async function fetchFlagList(
  accessToken: string,
  apiHost: string,
  projectId: number,
  query: string,
): Promise<FeatureFlag[]> {
  const endpoint = `/api/projects/${projectId}/feature_flags/`;
  const url = `${apiHost}${endpoint}?limit=${PAGE_LIMIT}${query}`;
  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': WIZARD_USER_AGENT,
      },
    });
    return FeatureFlagListResponseSchema.parse(response.data).results;
  } catch (error) {
    const apiError = handleApiError(error, 'fetch feature flags');
    analytics.captureException(apiError, { endpoint, apiHost, projectId });
    throw apiError;
  }
}

/**
 * The default list hides archived flags and never returns deleted ones, so an
 * archived-but-referenced flag needs the second query to show up at all.
 */
export async function fetchFeatureFlags(
  accessToken: string,
  apiHost: string,
  projectId: number,
): Promise<FeatureFlag[]> {
  const [live, archived] = await Promise.all([
    fetchFlagList(accessToken, apiHost, projectId, ''),
    fetchFlagList(accessToken, apiHost, projectId, '&archived=true'),
  ]);
  const seen = new Set<string>();
  return [...live, ...archived].filter((flag) => {
    if (seen.has(flag.key)) return false;
    seen.add(flag.key);
    return !flag.deleted;
  });
}
