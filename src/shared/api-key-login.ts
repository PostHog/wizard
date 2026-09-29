/** What a personal API key logs in to, the way `--ci` does: no browser, no OAuth. */

import {
  fetchProjectData,
  fetchUserData,
  type ApiProject,
  type ApiUser,
} from './api';
import { HostResolution } from './host-resolution';
import { analytics } from './utils/analytics';
import { logToFile } from './utils/debug';
import type { CloudRegion } from './utils/types';

export type ApiKeyLoginOptions = {
  region?: CloudRegion;
  baseUrl?: string; // pins every PostHog origin and skips region resolution
  localMcp?: boolean; // resolves `host.mcpUrl` to the local MCP server
  projectId?: number; // the project to use; else the key's current project
  onWarning?: (message: string) => void; // shown when the key can't read its user
};

/** The host, the project and, when the key can read it, the user `apiKey` belongs to. */
export async function resolveApiKeyProject(
  apiKey: string,
  options: ApiKeyLoginOptions = {},
): Promise<{
  host: HostResolution;
  project: ApiProject;
  apiUser: ApiUser | null;
}> {
  const host = await HostResolution.fromAccessToken(apiKey, {
    region: options.region,
    localMcp: options.localMcp,
    baseUrl: options.baseUrl,
  });
  const cloudUrl = host.appHost;
  const project =
    options.projectId != null
      ? await fetchProjectData(apiKey, options.projectId, cloudUrl)
      : await fetchKeyProject(apiKey, cloudUrl);

  // Best effort: project-scoped keys 403 on /api/users/@me/, so a null user is fine.
  let apiUser: ApiUser | null = null;
  try {
    apiUser = await fetchUserData(apiKey, cloudUrl);
  } catch (err) {
    logToFile(
      '[ci-auth] user lookup failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
  if (apiUser) {
    analytics.identifyUser(apiUser);
    logToFile(
      '[ci-auth] identified via API key; flags evaluate as the key owner',
    );
  } else {
    options.onWarning?.(
      'Could not resolve the API key user (key needs user:read scope) — feature flags evaluate anonymously; user-targeted flags will not match.',
    );
  }
  return { host, project, apiUser };
}

async function fetchKeyProject(
  apiKey: string,
  cloudUrl: string,
): Promise<ApiProject> {
  const userData = await fetchUserData(apiKey, cloudUrl);
  const projectId = userData.team?.id;
  if (!projectId) {
    throw new Error(
      'Could not determine project ID from API key. Please ensure your API key has access to a project in this cloud region.',
    );
  }
  return fetchProjectData(apiKey, projectId, cloudUrl);
}
