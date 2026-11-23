// Download a context-mill skill into a project, and recognise the agent's own skill-install command.

import path from 'path';
import fs from 'fs';
import { unzipSync } from 'fflate';
import { logToFile } from '@utils/debug';
import { analytics } from '@utils/analytics';
import { fetchWithRetry, type RetryOpts } from '@shared/fetch-retry';
import { PLAIN_NAME } from '@shared/skill-composition';
import { fetchSkillMenu, type SkillEntry } from '@shared/skill-menu';

/** Opens a file for writing and refuses a link at its last component, where the platform can. */
const WRITE_NO_FOLLOW =
  fs.constants.O_WRONLY | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW ?? 0);

/** `target` under `boundary` (which may itself be a link), refused when it leaves it or passes through a link. */
function plainTarget(
  boundary: string,
  target: string,
  last: 'file' | 'folder',
): string {
  const base = path.resolve(boundary);
  const resolved = path.resolve(base, target);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`path escapes destination: ${target}`);
  }
  const parts = path.relative(base, resolved).split(path.sep).filter(Boolean);
  let current = base;
  parts.forEach((part, index) => {
    current = path.join(current, part);
    const found = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!found) return;
    const isLeafFile = index === parts.length - 1 && last === 'file';
    const plain = isLeafFile ? found.isFile() : found.isDirectory();
    if (!plain) {
      throw new Error(`path passes through a link: ${target}`);
    }
    if (isLeafFile && found.nlink > 1) {
      throw new Error(`path is a hard link: ${target}`);
    }
  });
  return resolved;
}

function writeFileNoFollow(target: string, data: Uint8Array | string): void {
  const fd = fs.openSync(target, WRITE_NO_FOLLOW, 0o666);
  try {
    // Truncate only after the open file proves plain, so a hard link raced in after validation keeps its bytes.
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1) {
      throw new Error(`path is a hard link: ${target}`);
    }
    fs.ftruncateSync(fd, 0);
    fs.writeFileSync(fd, data);
  } finally {
    fs.closeSync(fd);
  }
}

/** Extract a zip buffer, refusing entries that escape destDir (zip-slip) or pass through a link. */
function extractZipArchive(zip: Uint8Array, destDir: string): number {
  const root = path.resolve(destDir);
  const rootStat = fs.lstatSync(root, { throwIfNoEntry: false });
  if (rootStat && !rootStat.isDirectory()) {
    throw new Error(`destination is not a plain folder: ${destDir}`);
  }
  // Pre-validate every entry before writing anything so a late failure leaves no unscanned files behind.
  const entries = Object.entries(unzipSync(zip)).map(([entryPath, data]) => {
    const isDir = entryPath.endsWith('/');
    const target = path.resolve(root, entryPath);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`zip entry escapes destination: ${entryPath}`);
    }
    if (!isDir && target === root) {
      throw new Error(`zip entry overwrites destination: ${entryPath}`);
    }
    plainTarget(root, target, isDir ? 'folder' : 'file');
    return { isDir, target, data };
  });
  let written = 0;
  for (const { isDir, target, data } of entries) {
    if (isDir) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    writeFileNoFollow(target, data);
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

/** The file the wizard drops in every skill folder it installs. */
export const WIZARD_MARKER = '.posthog-wizard';

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
  // The id comes from the menu and names the folder written to, so it is one plain name.
  if (!PLAIN_NAME.test(skillEntry.id)) {
    const error = `unusable skill id: ${skillEntry.id}`;
    logToFile(`downloadSkill: ${error}`);
    analytics.wizardCapture('skill install failed', {
      skill_id: skillEntry.id.slice(0, 200),
      step: 'download',
      platform: process.platform,
      error,
    });
    return { success: false, error };
  }
  const absInstallDir = path.resolve(installDir);
  let skillDir: string;
  let boundary: string;
  // Only a wizard-owned `skillsRoot` is held link-free from installDir down; `.claude/skills` may be shared.
  try {
    if (skillsRoot !== undefined && path.isAbsolute(skillsRoot)) {
      throw new Error(`path escapes destination: ${skillsRoot}`);
    }
    skillDir = skillsRoot
      ? path.resolve(absInstallDir, skillsRoot, skillEntry.id)
      : path.resolve(absInstallDir, '.claude', 'skills', skillEntry.id);
    boundary = skillsRoot ? absInstallDir : path.dirname(skillDir);
    plainTarget(boundary, skillDir, 'folder');
  } catch (err: any) {
    logToFile(`downloadSkill: refusing unsafe path: ${err.message}`);
    analytics.wizardCapture('skill install failed', {
      skill_id: skillEntry.id,
      step: 'download',
      platform: process.platform,
      error: String(err.message).slice(0, 500),
    });
    return { success: false, error: err.message };
  }
  let step: 'download' | 'extract' | 'scan' = 'download';
  // A failed install removes only a folder it made, so files that were there first stay.
  const existed =
    fs.lstatSync(skillDir, { throwIfNoEntry: false }) !== undefined;

  try {
    const data = await downloadWithRetry(skillEntry.downloadUrl);
    step = 'extract';
    plainTarget(boundary, skillDir, 'folder');
    plainTarget(skillDir, WIZARD_MARKER, 'file');
    fs.mkdirSync(skillDir, { recursive: true });
    const fileCount = extractZipArchive(data, skillDir);
    writeFileNoFollow(plainTarget(skillDir, WIZARD_MARKER, 'file'), '');

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
    if (!existed) {
      try {
        fs.rmSync(skillDir, { recursive: true, force: true });
      } catch {
        // The install has failed either way.
      }
    }
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

const claudeSkillsDir = (installDir: string): string =>
  path.join(installDir, '.claude', 'skills');

/**
 * Every entry in `<installDir>/.claude/skills`, or null when the folder can't
 * be read or a symlinked `.claude` or `skills` leads out of installDir.
 */
export function listSkillFolders(installDir: string): Set<string> | null {
  const dir = claudeSkillsDir(installDir);
  try {
    if (!fs.existsSync(dir)) return new Set();
    const root = fs.realpathSync(installDir);
    if (!fs.realpathSync(dir).startsWith(root + path.sep)) {
      logToFile(`listSkillFolders: ${dir} resolves outside ${installDir}`);
      return null;
    }
    return new Set(fs.readdirSync(dir));
  } catch (err) {
    logToFile(`listSkillFolders: could not read ${dir}: ${String(err)}`);
    return null;
  }
}

/**
 * Delete the wizard-marked skill folders that `before` didn't have, then the
 * skills folder if that left it empty. Anything that was there before the run
 * stays, as do symlinks and unmarked folders. Best-effort: a folder that won't
 * delete is logged and left, and a listing that is null, before or now,
 * deletes nothing.
 */
export function removeRunSkills(
  installDir: string,
  before: ReadonlySet<string> | null,
): string[] {
  const dir = claudeSkillsDir(installDir);
  const removed: string[] = [];
  const now = before && listSkillFolders(installDir);
  if (!before || !now) return removed;
  for (const id of now) {
    if (before.has(id)) continue;
    const skillDir = path.join(dir, id);
    try {
      if (!fs.lstatSync(skillDir).isDirectory()) continue;
      if (!fs.existsSync(path.join(skillDir, WIZARD_MARKER))) continue;
      fs.rmSync(skillDir, { recursive: true, force: true });
      removed.push(id);
    } catch (err) {
      logToFile(`removeRunSkills: could not remove ${id}: ${String(err)}`);
    }
  }
  try {
    // rmdir removes only an empty folder, so it can never take contents with it.
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  } catch {
    // Best-effort: an empty skills folder is harmless.
  }
  if (removed.length > 0) {
    logToFile(`removeRunSkills: removed ${removed.join(', ')}`);
  }
  return removed;
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
  downloadWithRetry,
};
