/**
 * Shared wizard-tool behavior — skill discovery/install, env-file helpers,
 * the wizard_ask cap policy, secret-vault plumbing, and the audit ledger.
 * One implementation consumed by both protocol facades: the MCP server
 * (`./mcp`) and the pi-native tools (`harness/pi/tools.ts`) — tool behavior
 * cannot drift between harnesses.
 */

import path from 'path';
import fs from 'fs';
import { unzipSync } from 'fflate';
import { logToFile } from '@utils/debug';
import { analytics } from '@utils/analytics';
import { writeJsonAtomic, makeMutex } from '@utils/atomic-ledger';
import {
  AUDIT_CHECKS_FILE,
  coerceAuditChecks,
  type AuditCheck,
  type AuditStatus,
} from '../programs/audit/types';
import { CANCELLED_SENTINEL } from '../wizard-ask-bridge';
import type { SecretVault } from '../secret-vault';
import { fetchWithRetry, type RetryOpts } from '../fetch-retry';

// ---------------------------------------------------------------------------
// Skill types
// ---------------------------------------------------------------------------

export type SkillEntry = {
  id: string;
  name: string;
  downloadUrl: string;
  /** The hyphenated skill-group prefix of `id` (e.g. `posthog-integration-install`). */
  group?: string;
  /** The detection id this variant serves (e.g. `rails`, `react-router`). */
  framework?: string;
  /** The variant a bare framework id resolves to when its family has several. */
  default?: boolean;
  /** This entry's download is a bundle JSON of every variant, not a single skill's zip. */
  bundle?: boolean;
  /** Menu-only: the variants inside a bundle, expanded into entries of their own on fetch. */
  variants?: { id: string; framework?: string; default?: boolean }[];
};

/** A bundle's files, keyed by variant short id then path. */
export type SkillBundle = {
  id: string;
  variants: Record<string, Record<string, string>>;
};

/**
 * Entry in the wizard's runtime CLI registry. Mirrors the shape context-mill
 * publishes under `cliEntries` inside `skill-menu.json`. The wizard uses these
 * to register skill-backed subcommands at runtime instead of from a baked
 * build-time snapshot.
 */
export type CliEntry = {
  skillId: string;
  role: 'command' | 'skill' | 'internal';
  command?: string;
  parentCommand?: string;
  default?: boolean;
  displayName: string;
  description: string;
};

export interface SkillMenu {
  categories: Record<string, SkillEntry[]>;
  /**
   * Skills exposed as CLI commands. Optional because context-mill releases
   * older than the runtime-resolver cutover don't emit this field.
   */
  cliEntries?: CliEntry[];
}

// ---------------------------------------------------------------------------
// Standalone skill helpers (usable before the MCP server is created)
// ---------------------------------------------------------------------------

/** Expand a bundle entry into one entry per variant, so the menu reads the same whether a group ships bundled or as zips. */
export function expandBundleEntry(entry: SkillEntry): SkillEntry[] {
  if (!entry.bundle || !entry.variants) return [entry];
  return entry.variants.map((variant) => ({
    ...variant,
    name: entry.name,
    group: entry.group,
    bundle: true,
    downloadUrl: entry.downloadUrl,
  }));
}

/**
 * Fetch the skill menu from the skills server.
 * Returns parsed data on success, `null` on failure.
 */
export async function fetchSkillMenu(
  skillsBaseUrl: string,
  opts: RetryOpts = {},
): Promise<SkillMenu | null> {
  const menuUrl = `${skillsBaseUrl}/skill-menu.json`;
  try {
    logToFile(`fetchSkillMenu: fetching from ${menuUrl}`);
    const resp = await fetchWithRetry(menuUrl, opts);
    const data = (await resp.json()) as SkillMenu;
    for (const [category, entries] of Object.entries(data.categories)) {
      data.categories[category] = entries.flatMap(expandBundleEntry);
    }
    logToFile(
      `fetchSkillMenu: loaded (${
        Object.keys(data.categories).length
      } categories)`,
    );
    return data;
  } catch (err: any) {
    logToFile(`fetchSkillMenu: error: ${err.message}`);
    return null;
  }
}

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

/**
 * Download and extract a skill.
 * By default installs to `<installDir>/.claude/skills/<id>/`.
 * Pass `skillsRoot` to override the base directory (e.g. `.posthog/skills`).
 */
export async function downloadSkill(
  skillEntry: SkillEntry,
  installDir: string,
  skillsRoot?: string,
): Promise<{ success: boolean; error?: string }> {
  const skillDir = skillsRoot
    ? path.join(installDir, skillsRoot, skillEntry.id)
    : path.join(installDir, '.claude', 'skills', skillEntry.id);
  let step: 'download' | 'extract' = 'download';

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
  skillsRoot?: string,
): Promise<InstallSkillResult> {
  const menu = await fetchSkillMenu(skillsBaseUrl);
  if (!menu) return { kind: 'menu-fetch-failed' };

  const skill = Object.values(menu.categories)
    .flat()
    .find((s) => s.id === skillId);
  if (!skill) return { kind: 'skill-not-found', skillId };

  const result = await downloadSkill(skill, installDir, skillsRoot);
  if (!result.success) {
    return { kind: 'download-failed', message: result.error ?? 'unknown' };
  }

  const relPath = skillsRoot
    ? `${skillsRoot}/${skillId}`
    : `.claude/skills/${skillId}`;
  return { kind: 'ok', path: relPath };
}

export const DEFAULT_ASK_MAX_QUESTIONS = 10;
/** The call after this many returns a one-time batch-your-questions nudge. */
export const ASK_BATCH_THRESHOLD = 3;

export type AskCapDecision =
  | { kind: 'ok' }
  | {
      kind: 'capped';
      reason: 'max_questions' | 'adjacency';
      message: string;
    };

/**
 * Pure decision function for the wizard_ask caps. Returns whether the
 * upcoming call should proceed and, if not, the error message to surface
 * to the agent. Extracted so the policy can be unit-tested without
 * spinning up an MCP server.
 *
 * The adjacency nudge fires exactly once per run (the caller records it
 * via `adjacencyNudged`) — flows that legitimately need several
 * sequential, answer-dependent asks then proceed up to `maxQuestions`.
 * Without the flag the rejected call would never advance the counter and
 * every later call would be rejected, making caps above the threshold
 * unreachable.
 */
export function evaluateAskCap(
  callCount: number,
  maxQuestions: number,
  adjacencyNudged = false,
): AskCapDecision {
  if (callCount >= maxQuestions) {
    return {
      kind: 'capped',
      reason: 'max_questions',
      message: `Error: wizard_ask cap reached (${maxQuestions} calls in this run). Proceed with sensible defaults using the answers you already have, or emit [ABORT] requirements-incomplete.`,
    };
  }
  if (!adjacencyNudged && callCount >= ASK_BATCH_THRESHOLD) {
    return {
      kind: 'capped',
      reason: 'adjacency',
      message: `Error: too many wizard_ask calls in a row (${callCount} so far). Batch the remaining questions into a single call — the schema accepts up to 8 questions per invocation. If the remaining questions truly depend on earlier answers, ask again and they will go through.`,
    };
  }
  return { kind: 'ok' };
}

// ---------------------------------------------------------------------------
// Env file helpers
// ---------------------------------------------------------------------------

export const ENV_FILE_PATH_DESCRIPTION =
  'Path to the .env file, relative to the wizard working directory. Pass ".env" for a file in that directory, or include the selected subproject path (for example, "packages/app/.env") for a nested project. Never prefix it with the wizard working directory\'s path inside an ancestor repository.';

/**
 * Resolve filePath relative to workingDirectory, rejecting path traversal.
 */
export function resolveEnvPath(
  workingDirectory: string,
  filePath: string,
): string {
  const resolved = path.resolve(workingDirectory, filePath);
  if (
    !resolved.startsWith(workingDirectory + path.sep) &&
    resolved !== workingDirectory
  ) {
    throw new Error(
      `Path traversal rejected: "${filePath}" resolves outside working directory`,
    );
  }
  return resolved;
}

/**
 * Ensure the given env file basename is covered by .gitignore in the working directory.
 * Creates .gitignore if it doesn't exist; appends the entry if missing.
 */
export function ensureGitignoreCoverage(
  workingDirectory: string,
  envFileName: string,
): void {
  const gitignorePath = path.join(workingDirectory, '.gitignore');

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    // Check if the file (or a glob covering it) is already listed
    if (content.split('\n').some((line) => line.trim() === envFileName)) {
      return;
    }
    const newContent = content.endsWith('\n')
      ? `${content}${envFileName}\n`
      : `${content}\n${envFileName}\n`;
    fs.writeFileSync(gitignorePath, newContent, 'utf8');
  } else {
    fs.writeFileSync(gitignorePath, `${envFileName}\n`, 'utf8');
  }
}

/**
 * Parse a .env file's content and return the set of defined key names.
 */
export function parseEnvKeys(content: string): Set<string> {
  const keys = new Set<string>();
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) {
      keys.add(match[1]);
    }
  }
  return keys;
}

/**
 * Merge key-value pairs into existing .env content.
 * Updates existing keys in-place, appends new keys at the end.
 */
export function mergeEnvValues(
  content: string,
  values: Record<string, string>,
): string {
  let result = content;
  const updatedKeys = new Set<string>();

  for (const [key, value] of Object.entries(values)) {
    // Preserve the existing `KEY=` prefix exactly; only swap the value.
    const regex = new RegExp(`^(\\s*${key}\\s*=).*$`, 'm');
    if (regex.test(result)) {
      result = result.replace(regex, `$1${value}`);
      updatedKeys.add(key);
    }
  }

  const newKeys = Object.entries(values).filter(
    ([key]) => !updatedKeys.has(key),
  );
  if (newKeys.length > 0) {
    if (result.length > 0 && !result.endsWith('\n')) {
      result += '\n';
    }
    for (const [key, value] of newKeys) {
      result += `${key}=${value}\n`;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Secret-vault plumbing shared by the MCP server and the pi-native tools —
// one implementation so the vault contract cannot drift between harnesses.
// ---------------------------------------------------------------------------

/**
 * Swap sensitive text answers for opaque vault refs before they return to
 * the agent — the raw value never enters the LLM conversation. Cancelled
 * answers pass through as the sentinel, unvaulted.
 */
export function vaultSensitiveAnswers(
  questions: readonly { id: string; prompt: string; sensitive?: boolean }[],
  answers: Record<string, string | string[]>,
  vault: SecretVault,
): Record<string, string | string[] | { secretRef: string }> {
  const sensitiveById = new Map(
    questions.filter((q) => q.sensitive).map((q) => [q.id, q.prompt]),
  );
  const sanitised: Record<string, string | string[] | { secretRef: string }> =
    {};
  for (const [id, answer] of Object.entries(answers)) {
    const label = sensitiveById.get(id);
    if (
      label !== undefined &&
      typeof answer === 'string' &&
      answer !== CANCELLED_SENTINEL
    ) {
      const ref = vault.put(answer, { label, source: 'wizard_ask' });
      sanitised[id] = { secretRef: ref };
      logToFile(`wizard_ask: vaulted answer for "${id}" as ${ref}`);
    } else {
      sanitised[id] = answer;
    }
  }
  return sanitised;
}

/** Resolution of a values map that may carry `{secretRef}` entries. */
export type ResolvedEnvValues =
  | { ok: true; values: Record<string, string>; refKeys: string[] }
  | { ok: false; key: string; secretRef: string };

/**
 * Resolve `{secretRef}` entries host-side, so the value is written but never
 * returned to the agent. Callers format their own error envelope from the
 * failing key/ref.
 */
export function resolveEnvSecretRefs(
  values: Record<string, string | { secretRef: string }>,
  vault: SecretVault,
): ResolvedEnvValues {
  const resolved: Record<string, string> = {};
  const refKeys: string[] = [];
  for (const [key, val] of Object.entries(values)) {
    if (typeof val === 'string') {
      resolved[key] = val;
      continue;
    }
    const secret = vault.get(val.secretRef);
    if (secret === undefined) {
      return { ok: false, key, secretRef: val.secretRef };
    }
    resolved[key] = secret;
    refKeys.push(key);
  }
  return { ok: true, values: resolved, refKeys };
}

// ---------------------------------------------------------------------------
// Audit ledger helpers
// ---------------------------------------------------------------------------

export const AUDIT_STATUSES: readonly AuditStatus[] = [
  'pending',
  'pass',
  'error',
  'warning',
  'suggestion',
];

/** Atomically write the audit ledger. Thin typed wrapper over writeJsonAtomic. */
export function writeLedgerAtomic(
  targetPath: string,
  checks: AuditCheck[],
): void {
  writeJsonAtomic(targetPath, checks);
}

/**
 * Apply a batch of patches to the ledger by id. Returns the new array and the
 * list of update ids that didn't match any existing check.
 */
export function applyAuditUpdates(
  current: AuditCheck[],
  updates: Array<{
    id: string;
    status: AuditStatus;
    file?: string;
    details?: string;
  }>,
): { next: AuditCheck[]; unknown: string[] } {
  const byId = new Map(current.map((c) => [c.id, c]));
  const unknown: string[] = [];

  for (const u of updates) {
    const existing = byId.get(u.id);
    if (!existing) {
      unknown.push(u.id);
      continue;
    }
    byId.set(u.id, {
      ...existing,
      status: u.status,
      ...(u.file !== undefined ? { file: u.file } : {}),
      ...(u.details !== undefined ? { details: u.details } : {}),
    });
  }

  return {
    next: current.map((c) => byId.get(c.id) ?? c),
    unknown,
  };
}

/**
 * Append new checks to a seeded ledger. Duplicate ids are reported without
 * mutating the current ledger, including duplicates inside the additions.
 */
function applyAuditAdditions(
  current: AuditCheck[],
  additions: AuditCheck[],
): { next: AuditCheck[]; duplicates: string[] } {
  const existingIds = new Set(current.map((c) => c.id));
  const additionIds = new Set<string>();
  const duplicates: string[] = [];

  for (const check of additions) {
    if (existingIds.has(check.id) || additionIds.has(check.id)) {
      duplicates.push(check.id);
      continue;
    }
    additionIds.add(check.id);
  }

  if (duplicates.length > 0) {
    return { next: current, duplicates };
  }

  return { next: [...current, ...additions], duplicates: [] };
}

export function readLedger(targetPath: string): AuditCheck[] {
  if (!fs.existsSync(targetPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    return coerceAuditChecks(parsed);
  } catch {
    return [];
  }
}

export type AppendAuditChecksResult =
  | { ok: true; added: number }
  | { ok: false; reason: 'missing-ledger' }
  | { ok: false; reason: 'duplicate-ids'; ids: string[] };

export function appendAuditChecksToLedger(
  targetPath: string,
  additions: AuditCheck[],
): AppendAuditChecksResult {
  if (!fs.existsSync(targetPath)) {
    return { ok: false, reason: 'missing-ledger' };
  }

  const current = readLedger(targetPath);
  const { next, duplicates } = applyAuditAdditions(current, additions);
  if (duplicates.length > 0) {
    return { ok: false, reason: 'duplicate-ids', ids: duplicates };
  }

  writeLedgerAtomic(targetPath, next);
  return { ok: true, added: additions.length };
}

export const SERVER_NAME = 'wizard-tools';

/** Tool names exposed by the wizard-tools server, keyed for selective use. */
// SDK expects MCP tool names in allowedTools/disallowedTools to be the
// fully-qualified `mcp__<server>__<tool>` form (sdk.d.ts: "Fully-qualified
// MCP tool name, e.g. mcp__server__tool_name."). The colon form silently
// fails to match, which made every program's `disallowedTools` entry a no-op.
export const WIZARD_TOOL_NAMES = {
  checkEnvKeys: `mcp__${SERVER_NAME}__check_env_keys`,
  setEnvValues: `mcp__${SERVER_NAME}__set_env_values`,
  detectPackageManager: `mcp__${SERVER_NAME}__detect_package_manager`,
  loadSkillMenu: `mcp__${SERVER_NAME}__load_skill_menu`,
  installSkill: `mcp__${SERVER_NAME}__install_skill`,
  auditSeedChecks: `mcp__${SERVER_NAME}__audit_seed_checks`,
  auditAddChecks: `mcp__${SERVER_NAME}__audit_add_checks`,
  auditResolveChecks: `mcp__${SERVER_NAME}__audit_resolve_checks`,
  wizardAsk: `mcp__${SERVER_NAME}__wizard_ask`,
  enqueueTask: `mcp__${SERVER_NAME}__enqueue_task`,
  completeTask: `mcp__${SERVER_NAME}__complete_task`,
  readHandoffs: `mcp__${SERVER_NAME}__read_handoffs`,
} as const;

// ---------------------------------------------------------------------------
// Test-only exports
// ---------------------------------------------------------------------------

export const __test = {
  extractZipArchive,
  extractBundle,
  fetchWithRetry,
  downloadWithRetry,
  writeLedgerAtomic,
  readLedger,
  applyAuditAdditions,
  appendAuditChecksToLedger,
  applyAuditUpdates,
  makeMutex,
  AUDIT_CHECKS_FILE,
};
