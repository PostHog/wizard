import * as fs from 'node:fs';

import type { ApiPrompt } from '../../lib/api';
import type { PromptSyncClient } from './prompt-sync-client';

export interface PromptSyncResult {
  client: string;
  written: number;
  removed: number;
  unchanged: number;
  failed: number;
  targetDir: string;
}

export interface PromptDiff {
  name: string;
  status: 'new' | 'updated' | 'unchanged' | 'removed';
}

/**
 * Computes per-prompt diff status by comparing remote prompts against what
 * exists locally for the first client. Uses the first client as a
 * representative since all clients share the same prompt set.
 */
export function diffPrompts(
  prompts: ApiPrompt[],
  clients: PromptSyncClient[],
  global: boolean,
  dirName: string,
): PromptDiff[] {
  const client = clients[0];
  if (!client) return prompts.map((p) => ({ name: p.name, status: 'new' }));

  const targetDir = client.getTargetDir(global, dirName);
  const remoteNames = new Set(prompts.map((p) => p.name));
  const localNames = new Set(client.listExistingPrompts(targetDir));

  const diffs: PromptDiff[] = [];

  for (const prompt of prompts) {
    const existingVersion = client.readVersion(prompt.name, targetDir);

    if (existingVersion === null) {
      diffs.push({ name: prompt.name, status: 'new' });
    } else if (existingVersion < prompt.version) {
      diffs.push({ name: prompt.name, status: 'updated' });
    } else {
      diffs.push({ name: prompt.name, status: 'unchanged' });
    }
  }

  for (const localName of localNames) {
    if (!remoteNames.has(localName)) {
      diffs.push({ name: localName, status: 'removed' });
    }
  }

  return diffs;
}

/**
 * Writes prompts to disk for each client, removes prompts that no longer
 * exist on the server, and writes index files for discovery.
 */
export function syncClients(
  prompts: ApiPrompt[],
  teamId: number,
  clients: PromptSyncClient[],
  global: boolean,
  dirName: string,
): PromptSyncResult[] {
  const results: PromptSyncResult[] = [];
  const promptsByName = new Map(prompts.map((p) => [p.name, p]));

  for (const client of clients) {
    const targetDir = client.getTargetDir(global, dirName);
    fs.mkdirSync(targetDir, { recursive: true });

    const localNames = new Set(client.listExistingPrompts(targetDir));
    let written = 0;
    let removed = 0;
    let unchanged = 0;
    let failed = 0;

    for (const prompt of prompts) {
      const existingVersion = client.readVersion(prompt.name, targetDir);
      if (existingVersion !== null && existingVersion >= prompt.version) {
        unchanged++;
        continue;
      }

      try {
        client.writePrompt(prompt, teamId, targetDir);
        written++;
      } catch {
        failed++;
      }
    }

    for (const localName of localNames) {
      if (!promptsByName.has(localName)) {
        try {
          client.removePrompt(localName, targetDir);
          removed++;
        } catch {
          failed++;
        }
      }
    }

    if (client.writeIndex) {
      client.writeIndex(prompts, targetDir);
    }

    results.push({
      client: client.name,
      written,
      removed,
      unchanged,
      failed,
      targetDir,
    });
  }

  return results;
}
