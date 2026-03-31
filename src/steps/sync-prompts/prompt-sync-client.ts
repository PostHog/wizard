import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';

import type { ApiPrompt } from '../../lib/api';
import { promptToSkillContent, promptToCursorRule } from './prompt-writer';

export const DEFAULT_DIR_NAME = 'posthog-prompts';

function readVersionFromFile(filePath: string): number | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const match = content.match(/version:\s*(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}

export interface PromptSyncClient {
  name: string;
  slug: string;
  getTargetDir(global: boolean, dirName?: string): string;
  writePrompt(prompt: ApiPrompt, teamId: number, targetDir: string): void;
  /** Lists prompt names that exist on disk in the target directory. */
  listExistingPrompts(targetDir: string): string[];
  /** Removes a single prompt from disk. */
  removePrompt(name: string, targetDir: string): void;
  /** Reads the version number from an existing prompt file, or null if missing. */
  readVersion(name: string, targetDir: string): number | null;
  /** Writes an index/root file that lists all prompts for discovery. */
  writeIndex?(prompts: ApiPrompt[], targetDir: string): void;
}

export class ClaudeCodePromptSyncClient implements PromptSyncClient {
  name = 'Claude Code';
  slug = 'claude-code';

  getTargetDir(global: boolean, dirName = DEFAULT_DIR_NAME): string {
    const base = global
      ? join(os.homedir(), '.claude', 'skills')
      : join(process.cwd(), '.claude', 'skills');
    return join(base, dirName);
  }

  writePrompt(prompt: ApiPrompt, teamId: number, targetDir: string): void {
    const promptDir = join(targetDir, prompt.name);
    fs.mkdirSync(promptDir, { recursive: true });
    fs.writeFileSync(
      join(promptDir, 'SKILL.md'),
      promptToSkillContent(prompt, teamId),
    );
  }

  listExistingPrompts(targetDir: string): string[] {
    try {
      return fs
        .readdirSync(targetDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      return [];
    }
  }

  removePrompt(name: string, targetDir: string): void {
    fs.rmSync(join(targetDir, name), { recursive: true, force: true });
  }

  readVersion(name: string, targetDir: string): number | null {
    return readVersionFromFile(join(targetDir, name, 'SKILL.md'));
  }

  writeIndex(prompts: ApiPrompt[], targetDir: string): void {
    const sorted = [...prompts].sort((a, b) => a.name.localeCompare(b.name));
    const listing = sorted
      .map((p) => `- **${p.name}** (v${p.version})`)
      .join('\n');

    const content = `---
name: posthog-prompts
description: >
  PostHog team prompts synced via posthog-wizard prompt sync.
  Contains ${prompts.length} prompt(s). Use the individual prompts
  by referencing their subdirectories.
metadata:
  source: posthog-prompt-sync
  prompt_count: ${prompts.length}
  synced_at: "${new Date().toISOString()}"
---

# PostHog Prompts

${prompts.length} prompt(s) synced from PostHog:

${listing}
`;

    fs.writeFileSync(join(targetDir, 'SKILL.md'), content);
  }
}

export class CursorPromptSyncClient implements PromptSyncClient {
  name = 'Cursor';
  slug = 'cursor';

  getTargetDir(global: boolean, dirName = DEFAULT_DIR_NAME): string {
    const base = global
      ? join(os.homedir(), '.cursor', 'rules')
      : join(process.cwd(), '.cursor', 'rules');
    return join(base, dirName);
  }

  writePrompt(prompt: ApiPrompt, _teamId: number, targetDir: string): void {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(
      join(targetDir, `${prompt.name}.mdc`),
      promptToCursorRule(prompt),
    );
  }

  listExistingPrompts(targetDir: string): string[] {
    try {
      return fs
        .readdirSync(targetDir)
        .filter((f) => f.endsWith('.mdc'))
        .map((f) => f.replace(/\.mdc$/, ''));
    } catch {
      return [];
    }
  }

  removePrompt(name: string, targetDir: string): void {
    try {
      fs.unlinkSync(join(targetDir, `${name}.mdc`));
    } catch {
      // Already gone
    }
  }

  readVersion(name: string, targetDir: string): number | null {
    return readVersionFromFile(join(targetDir, `${name}.mdc`));
  }
}

export function getAllPromptSyncClients(): PromptSyncClient[] {
  return [new ClaudeCodePromptSyncClient(), new CursorPromptSyncClient()];
}

export function getPromptSyncClientsBySlugs(
  slugs: string[],
): PromptSyncClient[] {
  const all = getAllPromptSyncClients();
  return all.filter((c) => slugs.includes(c.slug));
}
