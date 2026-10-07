// Download a context-mill skill into a project, and recognise the agent's own skill-install command.

import path from 'path';
import fs from 'fs';
import { unzipSync } from 'fflate';
import { logToFile } from '@utils/debug';
import { analytics } from '@utils/analytics';
import { fetchWithRetry, type RetryOpts } from '@shared/fetch-retry';
import { fetchSkillMenu, type SkillEntry } from '@shared/skill-menu';

/** A bundle's files, keyed by variant short id then path. */
export type SkillBundle = {
  id: string;
  variants: Record<string, Record<string, string>>;
};

/** Extract a zip buffer, refusing entries that escape destDir (zip-slip). */
function extractZipArchive(zip: Uint8Array, destDir: string): number {
  const root = path.resolve(destDir);
  let written = 0;
  for (const [entryPath, data] of Object.entries(unzipSync(zip))) {
    const target = path.resolve(root, entryPath);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`zip entry escapes destination: ${entryPath}`);
    }
    if (entryPath.endsWith('/')) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    written++;
  }
  return written;
}

/** Unpack the one variant this entry names out of a bundle; the rest is noise and never hits disk. */
function extractBundle(
  bundle: SkillBundle,
  destDir: string,
  entryId: string,
): number {
  if (
    typeof bundle?.id !== 'string' ||
    typeof bundle?.variants !== 'object' ||
    bundle.variants === null
  ) {
    throw new Error('malformed bundle: expected { id, variants }');
  }
  const files = bundle.variants[entryId.slice(bundle.id.length + 1)];
  if (!files) {
    throw new Error(`bundle ${bundle.id} has no variant "${entryId}"`);
  }
  const root = path.resolve(destDir);
  let written = 0;
  for (const [entryPath, contents] of Object.entries(files)) {
    const target = path.resolve(root, entryPath);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`bundle entry escapes destination: ${entryPath}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
    written++;
  }
  return written;
}

/** Download a URL to a buffer, retrying transient failures with backoff. */
async function downloadWithRetry(
  url: string,
  opts: RetryOpts = {},
): Promise<Uint8Array> {
  const resp = await fetchWithRetry(url, opts);
  return new Uint8Array(await resp.arrayBuffer());
}

/** Scans an extracted skill directory; a returned reason means it is poisoned. Injected because @shared cannot import @agent. */
export type SkillScanner = (skillDir: string) => Promise<string | null>;

/** How to place a skill and what scans it — `scan` is stated by every caller so none inherits a silent default. */
export interface SkillInstallOptions {
  /** Base directory override, e.g. `.posthog/skills`. Default `.claude/skills`. */
  skillsRoot?: string;
  scan: SkillScanner;
}

/**
 * Download and extract a skill.
 * By default installs to `<installDir>/.claude/skills/<id>/`.
 */
export async function downloadSkill(
  skillEntry: SkillEntry,
  installDir: string,
  { skillsRoot, scan }: SkillInstallOptions,
): Promise<{ success: boolean; error?: string }> {
  const skillDir = skillsRoot
    ? path.join(installDir, skillsRoot, skillEntry.id)
    : path.join(installDir, '.claude', 'skills', skillEntry.id);
  let step: 'download' | 'extract' | 'scan' = 'download';

  try {
    fs.mkdirSync(skillDir, { recursive: true });
    const data = await downloadWithRetry(skillEntry.downloadUrl);
    step = 'extract';
    const fileCount = skillEntry.bundle
      ? extractBundle(
          JSON.parse(Buffer.from(data).toString('utf8')) as SkillBundle,
          skillDir,
          skillEntry.id,
        )
      : extractZipArchive(data, skillDir);
    fs.writeFileSync(path.join(skillDir, '.posthog-wizard'), '');

    // Same scan the Bash-install hook runs — TS-path installs (linear
    // pre-install, MCP/pi install_skill, orchestrator cache + reference)
    // must not skip it.
    //
    // The scan is its own step: it runs the YARA-X WASM engine, and an engine
    // that fails to load throws from here. Left as `extract` that lands on the
    // event as an unzip failure, which the pure-JS unzip cannot produce.
    step = 'scan';
    const poisonReason = await scan(skillDir);
    if (poisonReason) {
      fs.rmSync(skillDir, { recursive: true, force: true });
      logToFile(`downloadSkill: ${poisonReason}`);
      analytics.wizardCapture('skill install failed', {
        skill_id: skillEntry.id,
        step: 'scan',
        platform: process.platform,
        error: poisonReason.slice(0, 500),
      });
      return { success: false, error: poisonReason };
    }

    logToFile(
      `downloadSkill: installed ${skillEntry.id} from ${skillEntry.downloadUrl} (${fileCount} files)`,
    );
    // The installed variant is a skill program's identity dimension in analytics.
    analytics.wizardCapture('skill installed', {
      skill_id: skillEntry.id,
      platform: process.platform,
    });
    return { success: true };
  } catch (err: any) {
    logToFile(`downloadSkill: error: ${err.message}`);
    // A skill-less run still reports success — keep the failure visible.
    analytics.wizardCapture('skill install failed', {
      skill_id: skillEntry.id,
      step,
      platform: process.platform,
      error: String(err.message).slice(0, 500),
    });
    return { success: false, error: err.message };
  }
}

/**
 * Structured result for installSkillById.
 * - `ok`: the skill was fetched and extracted; `path` is where it lives
 *   relative to installDir.
 * - `menu-fetch-failed`: couldn't fetch or parse the skill menu.
 * - `skill-not-found`: the menu didn't contain a skill with this id.
 * - `download-failed`: found the skill but download/extract failed;
 *   `message` has the underlying error.
 */
export type InstallSkillResult =
  | { kind: 'ok'; path: string }
  | { kind: 'menu-fetch-failed' }
  | { kind: 'skill-not-found'; skillId: string }
  | { kind: 'download-failed'; message: string };

/**
 * High-level "install a skill by ID" helper. Fetches the skill menu,
 * finds the skill, downloads and extracts it. Programs should use this
 * instead of composing fetchSkillMenu + downloadSkill themselves.
 */
export async function installSkillById(
  skillId: string,
  installDir: string,
  skillsBaseUrl: string,
  options: SkillInstallOptions,
): Promise<InstallSkillResult> {
  const menu = await fetchSkillMenu(skillsBaseUrl);
  if (!menu) return { kind: 'menu-fetch-failed' };

  const skill = Object.values(menu.categories)
    .flat()
    .find((s) => s.id === skillId);
  if (!skill) return { kind: 'skill-not-found', skillId };

  const result = await downloadSkill(skill, installDir, options);
  if (!result.success) {
    return { kind: 'download-failed', message: result.error ?? 'unknown' };
  }

  const relPath = options.skillsRoot
    ? `${options.skillsRoot}/${skillId}`
    : `.claude/skills/${skillId}`;
  return { kind: 'ok', path: relPath };
}

/**
 * Check if command is a PostHog skill installation from MCP.
 * We control the MCP server, so we only need to verify:
 * 1. It installs to .claude/skills/
 * 2. It downloads from a context-mill release origin (GitHub Releases or the
 *    AWS mirror) or localhost (dev)
 *
 * Extracted to its own module to avoid a circular dependency
 * between agent-interface.ts and yara-hooks.ts.
 */
export function isSkillInstallCommand(command: string): boolean {
  if (!command.startsWith('mkdir -p .claude/skills/')) return false;

  const urlMatch = command.match(/curl -sL ['"]([^'"]+)['"]/);
  if (!urlMatch) return false;

  // Literal prefixes rather than the constants in `@shared/constants`: an
  // allow-list is easier to audit when it reads as the URLs themselves.
  const url = urlMatch[1];
  return (
    url.startsWith('https://github.com/PostHog/context-mill/releases/') ||
    url.startsWith('https://context-mill.posthog.com/') ||
    /^http:\/\/localhost:\d+\//.test(url)
  );
}

// ---------------------------------------------------------------------------
// Test-only exports
// ---------------------------------------------------------------------------

export const __test = {
  extractZipArchive,
  extractBundle,
  downloadWithRetry,
};
