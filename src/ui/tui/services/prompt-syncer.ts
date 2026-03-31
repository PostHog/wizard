/**
 * PromptSyncer — service layer between PromptSyncScreen and prompt sync logic.
 *
 * Delegates to shared sync functions in src/steps/sync-prompts/ to avoid
 * duplicating auth, diff, and write logic.
 */

import {
  fetchPrompts as apiFetchPrompts,
  type ApiPrompt,
} from '../../../lib/api.js';
import { type PromptSyncClient } from '../../../steps/sync-prompts/prompt-sync-client.js';
import {
  resolvePromptSyncAuth,
  getPromptSyncClients,
  type PromptSyncAuth,
} from '../../../steps/sync-prompts/index.js';
import {
  syncClients,
  diffPrompts,
  type PromptSyncResult,
  type PromptDiff,
} from '../../../steps/sync-prompts/sync.js';

export type { PromptSyncAuth, PromptDiff, PromptSyncResult };

export interface PromptSyncer {
  resolveAuth(apiKey?: string): Promise<PromptSyncAuth>;
  fetchPrompts(auth: PromptSyncAuth): Promise<ApiPrompt[]>;
  getClients(slugs?: string[]): PromptSyncClient[];
  diffPrompts(
    prompts: ApiPrompt[],
    clients: PromptSyncClient[],
    global: boolean,
    dirName: string,
  ): PromptDiff[];
  sync(
    prompts: ApiPrompt[],
    teamId: number,
    clients: PromptSyncClient[],
    global: boolean,
    dirName: string,
  ): PromptSyncResult[];
}

export function createPromptSyncer(): PromptSyncer {
  return {
    resolveAuth: resolvePromptSyncAuth,

    async fetchPrompts(auth: PromptSyncAuth): Promise<ApiPrompt[]> {
      return apiFetchPrompts(auth.accessToken, auth.teamId, auth.cloudUrl);
    },

    getClients: getPromptSyncClients,
    diffPrompts,
    sync: syncClients,
  };
}
