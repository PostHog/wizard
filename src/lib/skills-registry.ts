/**
 * skills-registry.ts — Fetch and install PostHog skills from context-mill
 * GitHub Releases.
 *
 * Menu source (docs-skill-menu.json):
 *   https://github.com/PostHog/context-mill/releases/latest/download/docs-skill-menu.json
 *
 * Menu format:
 *   { version: '1.0', categories: { 'posthog-docs': [{ id, name, downloadUrl }] } }
 *
 * Install process per skill:
 *   1. Download the ZIP from downloadUrl
 *   2. Extract all files into .claude/skills/{skill-id}/
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'node:child_process';

const BASE_URL =
  process.env.POSTHOG_WIZARD_SKILLS_BASE_URL ??
  'https://github.com/PostHog/context-mill/releases/latest/download';

export const MENU_URL = `${BASE_URL}/docs-skill-menu.json`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillEntry {
  id: string;
  name: string;
  downloadUrl: string;
}

export interface SkillsMenu {
  skills: SkillEntry[];
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  }
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return new Uint8Array(await resp.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Fetch and parse the skills menu from context-mill's latest GitHub Release.
 * Returns null when the fetch fails or there are no skills in the menu.
 */
export async function fetchSkillsMenu(
  url = MENU_URL,
): Promise<SkillsMenu | null> {
  const data = await fetchJson<{
    version: string;
    categories: Record<string, SkillEntry[]>;
  }>(url);
  if (!data) return null;

  let skills = data.categories['posthog-docs'] ?? [];

  // When testing locally, rewrite download URLs to point at the local server
  if (process.env.POSTHOG_WIZARD_SKILLS_BASE_URL) {
    skills = skills.map((s) => ({
      ...s,
      downloadUrl: `${BASE_URL}/${s.id}.zip`,
    }));
  }

  return skills.length > 0 ? { skills } : null;
}

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

export interface InstallResult {
  success: boolean;
  filesWritten?: number;
  error?: string;
}

/**
 * Download a skill ZIP and extract it into `.claude/skills/` inside installDir.
 *
 * The ZIP is expected to contain a top-level directory named after the skill
 * (e.g. `posthog-feature-flags/SKILL.md`). Files are extracted preserving
 * that directory structure under `.claude/skills/`.
 */
export async function installSkill(
  entry: SkillEntry,
  installDir: string,
): Promise<InstallResult> {
  const skillsBase = path.join(installDir, '.claude', 'skills');
  const tmpFile = path.join(os.tmpdir(), `posthog-skill-${entry.id}.zip`);

  // Download
  const zipBytes = await fetchBytes(entry.downloadUrl);
  if (!zipBytes) {
    return {
      success: false,
      error: `Failed to download ${entry.downloadUrl}`,
    };
  }

  try {
    // Write ZIP to a temp file so the system unzip command can read it
    fs.mkdirSync(skillsBase, { recursive: true });
    fs.writeFileSync(tmpFile, zipBytes);

    // Extract into .claude/skills/
    execFileSync('unzip', ['-o', tmpFile, '-d', skillsBase], {
      timeout: 30000,
    });

    // Count extracted files
    const skillDir = path.join(skillsBase, entry.id);
    const filesWritten = fs.existsSync(skillDir)
      ? fs.readdirSync(skillDir, { recursive: true }).filter((f) => {
          const fullPath = path.join(skillDir, String(f));
          return fs.statSync(fullPath).isFile();
        }).length
      : 0;

    return { success: true, filesWritten };
  } catch (err) {
    return {
      success: false,
      error: `Failed to extract ZIP: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  } finally {
    // Clean up temp file
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* ignore cleanup errors */
    }
  }
}
