/**
 * Claude Code settings handling: conflict detection, backup/restore, and
 * orphan recovery.
 *
 * Lives apart from agent-interface so bin.ts can run orphan recovery at
 * process start without dragging in the agent stack (wizard-tools, yara
 * hooks, the SDK loader).
 */

import path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { analytics } from '@utils/analytics';
import { registerCleanup } from '@utils/wizard-abort';
import {
  BLOCKED_AGENT_ENV_KEYS,
  BLOCKED_AGENT_ENV_PATTERNS,
} from './agent-env-isolation';

// A settings.json `env` block is applied by the native binary itself, so the
// subprocess-env sanitizer can't strip it — the only defense is to detect the
// file and back it up / remove it. Flag the gateway-routing vars (a project
// pinning these overrides the wizard) plus every credential/routing knob the
// subprocess sanitizer strips (a settings env block can re-introduce any).
const BLOCKING_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  ...BLOCKED_AGENT_ENV_KEYS,
];
const BLOCKING_SETTINGS_KEYS = ['apiKeyHelper'];

/** Where a settings conflict was found. */
export type SettingsConflictSource =
  | 'project'
  | 'project-local'
  | 'user'
  | 'managed';

/** A single settings conflict detected during startup. */
export interface SettingsConflict {
  /** Where the conflict was found. */
  source: SettingsConflictSource;
  /** Absolute path of the file holding the override. */
  path: string;
  /** The blocking keys found (e.g. 'ANTHROPIC_BASE_URL', 'apiKeyHelper'). */
  keys: string[];
  /**
   * Whether the wizard can back up / remove this file. Only the project
   * `settings.json` is writable: managed settings are root-owned, and the
   * user's global config and gitignored `*.local.json` are left untouched so
   * we never mutate config outside the project we were pointed at.
   */
  writable: boolean;
}

/**
 * Check a single settings file for blocking env keys and top-level settings keys.
 * Returns matched key names, or an empty array if none found.
 */
function checkSettingsFile(filePath: string): string[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const matched: string[] = [];

    // Check env block for blocking env keys (exact names + provider-variant
    // patterns like ANTHROPIC_*_BASE_URL / CLAUDE_CODE_SKIP_*_AUTH).
    const envBlock = parsed?.env;
    if (envBlock && typeof envBlock === 'object') {
      matched.push(...BLOCKING_ENV_KEYS.filter((key) => key in envBlock));
      matched.push(
        ...Object.keys(envBlock).filter((key) =>
          BLOCKED_AGENT_ENV_PATTERNS.some((pattern) => pattern.test(key)),
        ),
      );
    }

    // Check top-level settings keys
    matched.push(
      ...BLOCKING_SETTINGS_KEYS.filter(
        (key) => key in parsed && parsed[key] !== '' && parsed[key] != null,
      ),
    );

    // A key can match both the exact list and a pattern — dedupe.
    return [...new Set(matched)];
  } catch {
    // File doesn't exist or isn't valid JSON — skip
    return [];
  }
}

/**
 * Check if .claude/settings.json in the project directory contains env
 * overrides or apiKeyHelper that block the Wizard from accessing the PostHog LLM Gateway.
 * Returns the list of matched key names, or an empty array if none found.
 *
 * @deprecated Use {@link checkAllSettingsConflicts} for comprehensive detection.
 */
export function checkClaudeSettingsOverrides(
  workingDirectory: string,
): string[] {
  const candidates = [
    path.join(workingDirectory, '.claude', 'settings.json'),
    path.join(workingDirectory, '.claude', 'settings'),
  ];

  for (const filePath of candidates) {
    const matched = checkSettingsFile(filePath);
    if (matched.length > 0) return matched;
  }

  return [];
}

/**
 * Org-managed (IT/MDM-deployed) settings path, per platform. Readable by all
 * users, writable only by root/admin. Claude Code always reads this file
 * regardless of `settingSources`, so an `apiKeyHelper` / `env` override here
 * redirects the agent off the gateway and the wizard cannot remove it — it
 * must fail closed. Checking only the macOS path (the prior behavior) let a
 * Linux/Windows managed override slip past the fail-closed gate undetected.
 */
export function managedSettingsPath(
  platform: NodeJS.Platform = process.platform,
): string {
  switch (platform) {
    case 'darwin':
      return '/Library/Application Support/ClaudeCode/managed-settings.json';
    case 'win32':
      return path.join(
        process.env.ProgramData || 'C:\\ProgramData',
        'ClaudeCode',
        'managed-settings.json',
      );
    default:
      // Linux and other POSIX platforms.
      return '/etc/claude-code/managed-settings.json';
  }
}

/**
 * Check every settings file Claude Code reads for blocking keys that conflict
 * with the wizard's gateway auth: org-managed, the user's global config, the
 * project config, and the gitignored project-local override. Each is a place
 * an `apiKeyHelper` or `ANTHROPIC_*` override commonly lives, and any of them
 * can outrank the env the wizard sets and make every agent call 401.
 */
export function checkAllSettingsConflicts(
  workingDirectory: string,
  homeDir: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): SettingsConflict[] {
  const conflicts: SettingsConflict[] = [];
  const home = homeDir;

  const sources: {
    source: SettingsConflictSource;
    paths: string[];
    writable: boolean;
  }[] = [
    {
      source: 'managed',
      paths: [managedSettingsPath(platform)],
      writable: false,
    },
    {
      source: 'user',
      paths: [
        path.join(home, '.claude', 'settings.json'),
        path.join(home, '.claude', 'settings.local.json'),
      ],
      writable: false,
    },
    {
      source: 'project',
      paths: [
        path.join(workingDirectory, '.claude', 'settings.json'),
        path.join(workingDirectory, '.claude', 'settings'),
      ],
      writable: true,
    },
    {
      source: 'project-local',
      paths: [path.join(workingDirectory, '.claude', 'settings.local.json')],
      writable: false,
    },
  ];

  for (const { source, paths, writable } of sources) {
    for (const filePath of paths) {
      const keys = checkSettingsFile(filePath);
      if (keys.length > 0) {
        conflicts.push({ source, path: filePath, keys, writable });
        break; // Only one conflict per source (settings.json vs settings fallback)
      }
    }
  }

  return conflicts;
}

/** A settings conflict sorted into how the wizard should respond to it. */
export interface ClassifiedSettingsConflicts {
  /**
   * Writable project `.claude/settings.json` — the SDK reads it under
   * `settingSources: ['project']`, but the wizard can back it up and remove it
   * (restored at outro). Neutralize automatically, no prompt.
   */
  autoFix: SettingsConflict[];
  /**
   * Org-managed settings — the SDK reads them on every run regardless of
   * `settingSources`, and they are root/admin-owned so the wizard cannot remove
   * them. Cannot be neutralized: the user (or their IT admin) must fix the file.
   */
  failClosed: SettingsConflict[];
  /**
   * User global (`~/.claude/…`) and project-local (`settings.local.json`)
   * settings. Already neutralized: `settingSources: ['project']` makes the SDK
   * ignore both (verified empirically). Warn for the record, but don't block.
   */
  warnOnly: SettingsConflict[];
}

/**
 * Sort detected conflicts by how the wizard can respond, following the rule:
 * **neutralize where possible; where it can't, let the user make the change.**
 *
 * NOTE: the `warnOnly` bucket assumes the agent runs with
 * `settingSources: ['project']` (set in `agent-interface.ts` and
 * `mcp-prompt-streaming.ts`). If that ever widens to include `'user'` / `'local'`,
 * those sources stop being neutralized and must move out of `warnOnly`.
 */
export function classifySettingsConflicts(
  conflicts: SettingsConflict[],
): ClassifiedSettingsConflicts {
  return {
    autoFix: conflicts.filter((c) => c.writable),
    failClosed: conflicts.filter((c) => !c.writable && c.source === 'managed'),
    warnOnly: conflicts.filter((c) => !c.writable && c.source !== 'managed'),
  };
}

/**
 * Ensure `.claude/.gitignore` excludes `*.wizard-backup` so a backup left
 * orphaned by an interrupted run can't get committed to git — settings files
 * commonly hold `apiKeyHelper` or `ANTHROPIC_API_KEY`, which we don't want
 * leaking into a repo.
 */
function ensureBackupGitignored(claudeDir: string): void {
  const gitignorePath = path.join(claudeDir, '.gitignore');
  const entry = '*.wizard-backup';
  try {
    const existing = fs.existsSync(gitignorePath)
      ? fs.readFileSync(gitignorePath, 'utf-8')
      : '';
    const lines = existing.split('\n').map((l) => l.trim());
    if (lines.includes(entry)) return;
    const sep = existing && !existing.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(gitignorePath, `${existing}${sep}${entry}\n`);
  } catch (error) {
    analytics.captureException(error);
  }
}

/**
 * Copy .claude/settings.json to .wizard-backup, then remove the original so
 * the SDK doesn't load the blocking overrides. Restored at outro and on
 * cleanup.
 */
export function backupAndFixClaudeSettings(workingDirectory: string): boolean {
  for (const name of ['settings.json', 'settings']) {
    const filePath = path.join(workingDirectory, '.claude', name);
    if (!fs.existsSync(filePath)) continue;
    const backupPath = `${filePath}.wizard-backup`;
    try {
      // Don't clobber a backup an earlier run already wrote — it holds the
      // pristine original. recoverOrphanedSettingsBackups resolves cross-run
      // orphans at process start, so a backup still present at this point
      // is from the current process and the current file is the modified one.
      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(filePath, backupPath);
        // Mirror the source's mode so a 0600 settings.json (apiKeyHelper,
        // API keys) doesn't become a 0644 backup readable by other local
        // users. copyFileSync would otherwise apply default umask.
        const mode = fs.statSync(filePath).mode & 0o777;
        fs.chmodSync(backupPath, mode);
      }
      ensureBackupGitignored(path.join(workingDirectory, '.claude'));
      fs.unlinkSync(filePath);
      analytics.wizardCapture('backedup-claude-settings');
      registerCleanup(() => {
        try {
          restoreClaudeSettings(workingDirectory);
        } catch (error) {
          analytics.captureException(error);
        }
      });
      return true;
    } catch (error) {
      analytics.captureException(error);
    }
  }
  return false;
}

/**
 * Restore .claude/settings.json from .wizard-backup and remove the backup.
 *
 * Runs on every outro and cleanup, including runs that never had a settings
 * conflict (and so never wrote a backup). A missing backup is the normal,
 * expected state for those runs, so skip it silently — only report a genuine
 * copy failure. Removing the backup after a successful restore keeps repeat
 * calls (outro then cleanup) idempotent and avoids leaving an orphan behind.
 */
export function restoreClaudeSettings(workingDirectory: string): void {
  for (const name of ['settings.json', 'settings']) {
    const original = path.join(workingDirectory, '.claude', name);
    const backup = `${original}.wizard-backup`;
    if (!fs.existsSync(backup)) continue;
    try {
      fs.copyFileSync(backup, original);
      fs.rmSync(backup, { force: true });
      analytics.wizardCapture('restored-claude-settings');
      return;
    } catch (error) {
      analytics.captureException(error);
    }
  }
}

/**
 * Restore an orphaned settings backup left by a previous interrupted run.
 *
 * If a run is killed after backupAndFixClaudeSettings moved the original
 * aside but before restore ran, the user is left with no settings.json and a
 * stray .wizard-backup. The next run's conflict check then sees no file and
 * skips restore, so the user's settings stay silently gone. Detect that exact
 * state (backup present, original absent) and put the original back.
 *
 * Runs once per process, from bin.ts, before anything reads Claude settings —
 * conflict detection must see the user's real settings file, and a recovery
 * any later would resurface the conflicting overrides after the backup step
 * already moved them aside.
 */
export function recoverOrphanedSettingsBackups(workingDirectory: string): void {
  for (const name of ['settings.json', 'settings']) {
    const original = path.join(workingDirectory, '.claude', name);
    const backup = `${original}.wizard-backup`;
    if (!fs.existsSync(backup) || fs.existsSync(original)) continue;
    try {
      fs.copyFileSync(backup, original);
      fs.rmSync(backup, { force: true });
      analytics.wizardCapture('recovered-orphaned-settings');
    } catch (error) {
      analytics.captureException(error);
    }
  }
}
