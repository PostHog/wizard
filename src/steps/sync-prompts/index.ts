import { fetchPrompts, fetchUserData } from '../../lib/api';
import { getUI } from '../../ui';
import { detectRegionFromToken, getCloudUrlFromRegion } from '../../utils/urls';
import { performOAuthFlow } from '../../utils/oauth';
import {
  getAllPromptSyncClients,
  getPromptSyncClientsBySlugs,
  DEFAULT_DIR_NAME,
} from './prompt-sync-client';
import { syncClients } from './sync';

interface SyncPromptsOptions {
  apiKey?: string;
  projectId?: number;
  global?: boolean;
  debug?: boolean;
  clients?: string[];
  dirName?: string;
}

export interface PromptSyncAuth {
  accessToken: string;
  teamId: number;
  cloudUrl: string;
}

/**
 * Resolves authentication and returns the access token, team ID, and cloud URL.
 * Uses the API key if provided, otherwise initiates an OAuth flow.
 */
export async function resolvePromptSyncAuth(
  apiKey?: string,
): Promise<PromptSyncAuth> {
  let accessToken: string;

  if (apiKey) {
    accessToken = apiKey;
  } else {
    getUI().log.info('Opening browser for PostHog login\u2026');
    const tokenResponse = await performOAuthFlow({
      scopes: ['user:read', 'project:read', 'llm_prompt:read'],
    });
    accessToken = tokenResponse.access_token;
  }

  const cloudRegion = await detectRegionFromToken(accessToken);
  const cloudUrl = getCloudUrlFromRegion(cloudRegion);
  const userData = await fetchUserData(accessToken, cloudUrl);

  const teamId = userData.team?.id;
  if (!teamId) {
    throw new Error(
      'Could not determine team ID. Ensure your API key has access to a project.',
    );
  }

  return { accessToken, teamId, cloudUrl };
}

export function getPromptSyncClients(slugs?: string[]) {
  if (slugs && slugs.length > 0) {
    return getPromptSyncClientsBySlugs(slugs);
  }
  return getAllPromptSyncClients();
}

export async function syncPromptsStep(
  options: SyncPromptsOptions,
): Promise<void> {
  const auth = await resolvePromptSyncAuth(options.apiKey);

  getUI().log.info('Fetching prompts\u2026');
  const prompts = await fetchPrompts(
    auth.accessToken,
    auth.teamId,
    auth.cloudUrl,
  );

  if (prompts.length === 0) {
    getUI().log.info('No prompts found for this team.');
    return;
  }

  const global = options.global ?? false;
  const dirName = options.dirName ?? DEFAULT_DIR_NAME;
  const clients = getPromptSyncClients(options.clients);

  const results = syncClients(prompts, auth.teamId, clients, global, dirName);
  let hasFailures = false;

  for (const r of results) {
    if (r.failed > 0) {
      hasFailures = true;
    }

    const parts: string[] = [];
    if (r.written > 0) parts.push(`${r.written} written`);
    if (r.removed > 0) parts.push(`${r.removed} removed`);
    if (r.unchanged > 0) parts.push(`${r.unchanged} unchanged`);
    if (r.failed > 0) parts.push(`${r.failed} failed`);
    if (parts.length > 0) {
      getUI().log.info(
        `${r.client}: ${parts.join(', ')} \u2192 ${r.targetDir}`,
      );
    }
  }

  if (hasFailures) {
    process.exitCode = 1;
  }
}
