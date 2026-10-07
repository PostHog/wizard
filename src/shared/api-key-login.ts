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
  onInfo?: (message: string) => void; // the login's progress line
};

/** The host, the project and, when the key can read it, the user `apiKey` belongs to. */
export async function resolveApiKeyProject(
  apiKey: string,
  options: ApiKeyLoginOptions = {},
): Promise<{
  host: HostResolution;
  project: ApiProject;
  projectId: number;
  apiUser: ApiUser | null;
}> {
  options.onInfo?.('Using provided API key (CI mode - OAuth bypassed)');
  const host = await HostResolution.fromAccessToken(apiKey, {
    region: options.region,
    localMcp: options.localMcp,
    baseUrl: options.baseUrl,
  });
  const cloudUrl = host.appHost;
  const projectData =
    options.projectId != null
      ? await fetchProjectDataById(apiKey, options.projectId, cloudUrl)
      : await fetchProjectDataWithApiKey(apiKey, cloudUrl);

  // Best-effort user fetch — CI flows may run with project-scoped keys
  // that 403 on /api/users/@me/, so swallow errors and continue with
  // a null user (and null role).
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
  return {
    host,
    project: projectData.project,
    projectId: projectData.id,
    apiUser,
  };
}

async function fetchProjectDataWithApiKey(
  apiKey: string,
  cloudUrl: string,
): Promise<{ api_token: string; id: number; project: ApiProject }> {
  const userData = await fetchUserData(apiKey, cloudUrl);
  const projectId = userData.team?.id;

  if (!projectId) {
    throw new Error(
      'Could not determine project ID from API key. Please ensure your API key has access to a project in this cloud region.',
    );
  }

  const projectData = await fetchProjectData(apiKey, projectId, cloudUrl);
  return {
    api_token: projectData.api_token,
    id: projectId,
    project: projectData,
  };
}

async function fetchProjectDataById(
  apiKey: string,
  projectId: number,
  cloudUrl: string,
): Promise<{ api_token: string; id: number; project: ApiProject }> {
  const projectData = await fetchProjectData(apiKey, projectId, cloudUrl);
  return {
    api_token: projectData.api_token,
    id: projectId,
    project: projectData,
  };
}
