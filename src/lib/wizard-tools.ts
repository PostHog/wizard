/**
 * Unified in-process MCP server for the PostHog wizard.
 *
 * Provides tools that run locally (secret values never leave the machine):
 * - check_env_keys: Check which env var keys exist in a .env file
 * - set_env_values: Create/update env vars in a .env file
 * - detect_package_manager: Detect the project's package manager(s)
 * - load_skill_menu / install_skill: Skill installation
 * - audit_seed_checks / audit_add_checks / audit_resolve_checks: Audit ledger ownership
 */

import path from 'path';
import fs from 'fs';
import { unzipSync } from 'fflate';
import { z } from 'zod';
import { logToFile } from '@utils/debug';
import { analytics } from '@utils/analytics';
import { writeJsonAtomic, makeMutex } from '@utils/atomic-ledger';
import type { PackageManagerDetector } from './detection/package-manager';
import {
  AUDIT_CHECKS_FILE,
  coerceAuditChecks,
  type AuditCheck,
  type AuditStatus,
} from './programs/audit/types';
import { type WizardAskBridge, isFullyCancelled } from './wizard-ask-bridge';
import { createSecretVault, type SecretVault } from './secret-vault';
import { fetchWithRetry, type RetryOpts } from './fetch-retry';
import {
  buildOrchestratorTools,
  type OrchestratorToolsContext,
} from './agent/runner/sequence/orchestrator/queue-tools';

// ---------------------------------------------------------------------------
// SDK dynamic import (ESM module loaded once, cached)
// ---------------------------------------------------------------------------

let _sdkModule: any = null;
async function getSDKModule(): Promise<any> {
  if (!_sdkModule) {
    _sdkModule = await import('@anthropic-ai/claude-agent-sdk');
  }
  return _sdkModule;
}

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
    const zip = await downloadWithRetry(skillEntry.downloadUrl);
    step = 'extract';
    const fileCount = extractZipArchive(zip, skillDir);
    fs.writeFileSync(path.join(skillDir, '.posthog-wizard'), '');

    logToFile(
      `downloadSkill: installed ${skillEntry.id} from ${skillEntry.downloadUrl} (${fileCount} files)`,
    );
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

// ---------------------------------------------------------------------------
// Options for creating the wizard tools server
// ---------------------------------------------------------------------------

export interface WizardToolsOptions {
  /** Root directory of the project being analyzed */
  workingDirectory: string;

  /** Framework-specific package manager detector */
  detectPackageManager: PackageManagerDetector;

  /** Base URL for the skills server (e.g. http://localhost:8765 or GitHub releases URL) */
  skillsBaseUrl: string;

  /**
   * Bridge that drives the `wizard_ask` overlay. When omitted, the
   * `wizard_ask` tool is still registered but returns an error explaining
   * the host is non-interactive — keeps the tool surface stable across
   * CI/dev environments.
   */
  askBridge?: WizardAskBridge;

  /**
   * Per-run cap on `wizard_ask` invocations. Defaults to {@link DEFAULT_ASK_MAX_QUESTIONS}.
   * The 4th call always returns a "batch your questions" error regardless
   * of this cap — see {@link ASK_BATCH_THRESHOLD}.
   */
  askMaxQuestions?: number;

  /**
   * Optional secret vault. When provided, tools that handle sensitive
   * values (wizard_ask with `sensitive: true`, set_env_values) route
   * those values through the vault and return opaque refs to the agent
   * instead of raw strings — so the LLM never sees them. When omitted
   * (e.g. in unit tests), a fresh vault is created internally.
   */
  secretVault?: SecretVault;

  /**
   * Orchestrator queue context. Present only when the `wizard-orchestrator`
   * flag routes the run to the orchestrator; when set, the orchestrator tools
   * (enqueue_task, complete_task, read_handoffs) are registered. Absent on the
   * linear path.
   */
  orchestrator?: OrchestratorToolsContext;
}

/** Default per-run cap on wizard_ask calls when no override is provided. */
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
// Audit ledger helpers
// ---------------------------------------------------------------------------

const AUDIT_STATUSES: readonly AuditStatus[] = [
  'pending',
  'pass',
  'error',
  'warning',
  'suggestion',
];

const auditCheckSchema = z.object({
  id: z.string().min(1),
  area: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(AUDIT_STATUSES as [AuditStatus, ...AuditStatus[]]),
  file: z.string().optional(),
  details: z.string().optional(),
});

const auditUpdateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(AUDIT_STATUSES as [AuditStatus, ...AuditStatus[]]),
  file: z.string().optional(),
  details: z.string().optional(),
});

/** Atomically write the audit ledger. Thin typed wrapper over writeJsonAtomic. */
function writeLedgerAtomic(targetPath: string, checks: AuditCheck[]): void {
  writeJsonAtomic(targetPath, checks);
}

/**
 * Apply a batch of patches to the ledger by id. Returns the new array and the
 * list of update ids that didn't match any existing check.
 */
function applyAuditUpdates(
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

function readLedger(targetPath: string): AuditCheck[] {
  if (!fs.existsSync(targetPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    return coerceAuditChecks(parsed);
  } catch {
    return [];
  }
}

type AppendAuditChecksResult =
  | { ok: true; added: number }
  | { ok: false; reason: 'missing-ledger' }
  | { ok: false; reason: 'duplicate-ids'; ids: string[] };

function appendAuditChecksToLedger(
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

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

const SERVER_NAME = 'wizard-tools';

/**
 * Create the unified in-process MCP server with all wizard tools.
 * Must be called asynchronously because the SDK is an ESM module loaded via dynamic import.
 */
export async function createWizardToolsServer(options: WizardToolsOptions) {
  const {
    workingDirectory,
    detectPackageManager,
    skillsBaseUrl,
    askBridge,
    askMaxQuestions = DEFAULT_ASK_MAX_QUESTIONS,
    secretVault = createSecretVault(),
    orchestrator,
  } = options;
  const sdk = await getSDKModule();
  const { tool, createSdkMcpServer } = sdk;

  // Per-server counter for wizard_ask call accounting (adjacency + total cap).
  let askCallCount = 0;
  // The adjacency nudge fires once per run; after that only the total cap applies.
  let askAdjacencyNudged = false;

  // Pre-fetch skill menu so category names are available in the tool schema
  let cachedSkillMenu: Record<string, SkillEntry[]> = {};
  let categoryNames: [string, ...string[]] = ['integration'];

  const menu = await fetchSkillMenu(skillsBaseUrl);
  if (menu) {
    cachedSkillMenu = menu.categories;
  }

  const keys = Object.keys(cachedSkillMenu);
  if (keys.length > 0) {
    categoryNames = keys as [string, ...string[]];
  }

  // -- check_env_keys -------------------------------------------------------

  const checkEnvKeys = tool(
    'check_env_keys',
    'Check which environment variable keys are present or missing in a .env file. Never reveals values.',
    {
      filePath: z.string().describe(ENV_FILE_PATH_DESCRIPTION),
      keys: z
        .array(z.string())
        .describe('Environment variable key names to check'),
    },
    (args: { filePath: string; keys: string[] }) => {
      const resolved = resolveEnvPath(workingDirectory, args.filePath);
      logToFile(`check_env_keys: ${resolved}, keys: ${args.keys.join(', ')}`);

      const existingKeys: Set<string> = fs.existsSync(resolved)
        ? parseEnvKeys(fs.readFileSync(resolved, 'utf8'))
        : new Set<string>();

      const results: Record<string, 'present' | 'missing'> = {};
      for (const key of args.keys) {
        results[key] = existingKeys.has(key) ? 'present' : 'missing';
      }

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(results, null, 2) },
        ],
      };
    },
  );

  // -- set_env_values -------------------------------------------------------

  const setEnvValues = tool(
    'set_env_values',
    'Create or update environment variable keys in a .env file. Creates the file if it does not exist. Ensures .gitignore coverage. Each value can be either a literal string or a secret reference of the form `{ "secretRef": "secret:..." }` returned by another tool (e.g. wizard_ask). Secret references are resolved locally — the actual value is written to the file but never returned to the agent.',
    {
      filePath: z.string().describe(ENV_FILE_PATH_DESCRIPTION),
      values: z
        .record(
          z.string(),
          z.union([z.string(), z.object({ secretRef: z.string() })]),
        )
        .describe(
          'Key → (literal string OR { secretRef } pointing to a vaulted secret)',
        ),
    },
    (args: {
      filePath: string;
      values: Record<string, string | { secretRef: string }>;
    }) => {
      // Block the wrong key name — the correct key is NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN or similar
      const forbidden = Object.keys(args.values).find(
        (k) => k.toUpperCase() === 'POSTHOG_KEY',
      );
      if (forbidden) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: "${forbidden}" is not a valid PostHog env var name. Use the project-specific key name from your framework's integration guide (e.g. NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN).`,
            },
          ],
          isError: true,
        };
      }

      // Resolve any secret refs from the vault before writing.
      const resolvedValues: Record<string, string> = {};
      const resolvedRefKeys: string[] = [];
      for (const [key, val] of Object.entries(args.values)) {
        if (typeof val === 'string') {
          resolvedValues[key] = val;
        } else {
          const secret = secretVault.get(val.secretRef);
          if (secret === undefined) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Error: secret reference "${val.secretRef}" for key "${key}" is not known to the vault. The ref may have expired, been minted in a different run, or been mistyped.`,
                },
              ],
              isError: true,
            };
          }
          resolvedValues[key] = secret;
          resolvedRefKeys.push(key);
        }
      }

      const resolved = resolveEnvPath(workingDirectory, args.filePath);
      logToFile(
        `set_env_values: ${resolved}, keys: ${Object.keys(resolvedValues).join(
          ', ',
        )}${
          resolvedRefKeys.length > 0
            ? ` (secret refs: ${resolvedRefKeys.join(', ')})`
            : ''
        }`,
      );

      const existing = fs.existsSync(resolved)
        ? fs.readFileSync(resolved, 'utf8')
        : '';
      const content = mergeEnvValues(existing, resolvedValues);

      // Env files belong in directories that already exist. Refusing to create
      // parents catches the classic agent mistake of re-prefixing the wizard
      // working directory with its ancestor-repo-relative location (e.g.
      // "apps/web/.env" while already running in apps/web), which would
      // otherwise silently nest a duplicate tree.
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) {
        analytics.wizardCapture('set_env_values parent dir missing', {
          platform: process.platform,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: parent directory does not exist: "${path.dirname(
                args.filePath,
              )}". filePath is resolved against the wizard working directory — pass ".env" for a file there, or "<subproject>/.env" for an existing nested project.`,
            },
          ],
          isError: true,
        };
      }

      fs.writeFileSync(resolved, content, 'utf8');

      // Ensure .gitignore coverage for this env file
      const envFileName = path.basename(resolved);
      ensureGitignoreCoverage(workingDirectory, envFileName);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Updated ${Object.keys(args.values).length} key(s) in ${
              args.filePath
            }`,
          },
        ],
      };
    },
  );

  // -- detect_package_manager -----------------------------------------------

  const detectPM = tool(
    'detect_package_manager',
    'Detect which package manager(s) the project uses. Returns the name, install command, and run command for each detected package manager. Call this before running any install commands.',
    {},
    async () => {
      logToFile(`detect_package_manager: scanning ${workingDirectory}`);

      const result = await detectPackageManager(workingDirectory);

      logToFile(
        `detect_package_manager: detected ${result.detected.length} package manager(s)`,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  // -- load_skill_menu ------------------------------------------------------

  const loadSkillMenu = tool(
    'load_skill_menu',
    'Load available PostHog skills for a category. Returns skill IDs and names. Call this first, then use install_skill with the chosen ID.',
    {
      category: z.enum(categoryNames).describe('Skill category'),
    },
    (args: { category: string }) => {
      const skills = cachedSkillMenu[args.category];
      if (!skills || skills.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No skills found for category "${args.category}".`,
            },
          ],
          isError: true,
        };
      }

      const menuText = skills.map((s) => `- ${s.id}: ${s.name}`).join('\n');

      logToFile(
        `load_skill_menu: returning ${skills.length} skills for "${args.category}"`,
      );

      return {
        content: [{ type: 'text' as const, text: menuText }],
      };
    },
  );

  // -- install_skill --------------------------------------------------------

  const installSkill = tool(
    'install_skill',
    'Download and install a PostHog skill by ID. Call load_skill_menu first to see available skills. Extracts the skill to .claude/skills/<skillId>/.',
    {
      skillId: z
        .string()
        .describe(
          'Skill ID from the skill menu (e.g., "integration-nextjs-app-router")',
        ),
    },
    async (args: { skillId: string }) => {
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(args.skillId)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: skillId must be lowercase alphanumeric with hyphens.',
            },
          ],
          isError: true,
        };
      }

      // Look up download URL from cached menu
      const allSkills: SkillEntry[] = Object.values(cachedSkillMenu).flat();
      const skill = allSkills.find((s) => s.id === args.skillId);
      if (!skill) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: skill "${args.skillId}" not found. Use load_skill_menu to see available skills.`,
            },
          ],
          isError: true,
        };
      }

      const result = await downloadSkill(skill, workingDirectory);
      if (result.success) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Skill installed to .claude/skills/${args.skillId}/`,
            },
          ],
        };
      } else {
        // The agent only sees a tool-result string — report the failure too.
        analytics.captureException(
          new Error('Skill install failed: download-failed'),
          {
            source: 'install_skill_tool',
            skill_id: args.skillId,
            error_detail: String(result.error).slice(0, 500),
            platform: process.platform,
          },
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error installing skill: ${result.error}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -- audit_seed_checks ----------------------------------------------------

  const auditLedgerPath = path.join(workingDirectory, AUDIT_CHECKS_FILE);
  const auditMutex = makeMutex();

  const auditSeedChecks = tool(
    'audit_seed_checks',
    'Seed the audit ledger at .posthog-audit-checks.json with the full set of pending checks. Call this once at the start of the audit. Atomically replaces any existing ledger.',
    {
      checks: z
        .array(auditCheckSchema)
        .describe('Full pending checklist to write to the ledger'),
    },
    async (args: { checks: AuditCheck[] }) => {
      return auditMutex(() => {
        writeLedgerAtomic(auditLedgerPath, args.checks);
        logToFile(`audit_seed_checks: wrote ${args.checks.length} entries`);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Seeded ${args.checks.length} audit checks.`,
            },
          ],
        };
      });
    },
  );

  // -- audit_add_checks -----------------------------------------------------

  const auditAddChecks = tool(
    'audit_add_checks',
    'Append one or more pending checks to the existing audit ledger at .posthog-audit-checks.json. Call audit_seed_checks first. Atomically rejects duplicate ids without changing the ledger.',
    {
      checks: z
        .array(auditCheckSchema)
        .min(1)
        .describe('Additional checks to append to the existing ledger'),
    },
    async (args: { checks: AuditCheck[] }) => {
      return auditMutex(() => {
        const result = appendAuditChecksToLedger(auditLedgerPath, args.checks);

        if (!result.ok) {
          if (result.reason === 'missing-ledger') {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'Error: audit ledger does not exist. Run audit_seed_checks first.',
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: duplicate check id(s): ${result.ids.join(
                  ', ',
                )}. Check ids must be unique.`,
              },
            ],
            isError: true,
          };
        }

        logToFile(`audit_add_checks: added ${result.added} entries`);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Added ${result.added} audit check(s).`,
            },
          ],
        };
      });
    },
  );

  // -- audit_resolve_checks -------------------------------------------------

  const auditResolveChecks = tool(
    'audit_resolve_checks',
    "Resolve one or more audit checks by id. Patches each entry's status (and optional file/details) and writes the ledger back atomically. Concurrent calls serialize.",
    {
      updates: z
        .array(auditUpdateSchema)
        .min(1)
        .describe('Patches to apply, keyed by check id'),
    },
    async (args: {
      updates: Array<{
        id: string;
        status: AuditStatus;
        file?: string;
        details?: string;
      }>;
    }) => {
      return auditMutex(() => {
        const current = readLedger(auditLedgerPath);
        const { next, unknown } = applyAuditUpdates(current, args.updates);

        if (unknown.length > 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: unknown check id(s): ${unknown.join(
                  ', ',
                )}. Run audit_seed_checks first or check the id.`,
              },
            ],
            isError: true,
          };
        }

        writeLedgerAtomic(auditLedgerPath, next);
        logToFile(
          `audit_resolve_checks: applied ${args.updates.length} update(s)`,
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: `Resolved ${args.updates.length} check(s).`,
            },
          ],
        };
      });
    },
  );

  // -- wizard_ask -----------------------------------------------------------

  const askQuestionSchema = z.object({
    id: z
      .string()
      .min(1)
      .describe('Stable key for the answer in the response map'),
    prompt: z.string().min(1).describe('Question text shown to the user'),
    kind: z
      .enum(['single', 'multi', 'text'])
      .describe(
        "'single' = pick one option, 'multi' = pick any, 'text' = free-form single-line answer",
      ),
    options: z
      .array(
        z.object({
          label: z.string(),
          value: z.string(),
          description: z
            .string()
            .optional()
            .describe(
              'Optional secondary line shown dimmed and wrapped beneath the ' +
                'label (multi-select only). Use when a choice needs more than a ' +
                'title — e.g. what a custom scout watches and what makes it speak up.',
            ),
        }),
      )
      .optional()
      .describe('Required for kind=single|multi; ignored for kind=text'),
    required: z.boolean().optional().describe('Defaults to true'),
    sensitive: z
      .boolean()
      .optional()
      .describe(
        "Only valid for kind='text'. When true, the user's answer is stored in the wizard's secret vault and returned to you as { secretRef: 'secret:...' } instead of the raw string. Use for API keys, tokens, and any other secret the user types in. The secretRef is only resolved by wizard-tools that accept it (e.g. set_env_values) — it is NOT resolved when passed to other MCP tools (e.g. PostHog data-warehouse tools), which will reject it. For a secret that must reach another tool, write it to the env with set_env_values first, or use that tool's own credential-reference flow.",
      ),
  });

  const wizardAsk = tool(
    'wizard_ask',
    'Ask the user one or more structured questions and wait for their answers. ' +
      'Use this whenever you would otherwise inline a question in your text output. ' +
      'Batch related questions into a single call (up to 8) rather than asking one at a ' +
      'time; sequential calls are fine when later questions genuinely depend on earlier ' +
      'answers. A fully cancelled or timed-out response does NOT count against the per-run ' +
      'cap — treat it as "the user declined" and fall back gracefully (e.g. hand over a ' +
      'deep link) without worrying about a wasted call.',
    {
      questions: z.array(askQuestionSchema).min(1).max(8),
    },
    async (args: {
      questions: Array<{
        id: string;
        prompt: string;
        kind: 'single' | 'multi' | 'text';
        options?: { label: string; value: string }[];
        required?: boolean;
        sensitive?: boolean;
      }>;
    }) => {
      if (!askBridge) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: wizard_ask is not available in this environment (CI / non-interactive). Proceed with sensible defaults or emit [ABORT] requirements-incomplete.',
            },
          ],
          isError: true,
        };
      }

      const capDecision = evaluateAskCap(
        askCallCount,
        askMaxQuestions,
        askAdjacencyNudged,
      );
      if (capDecision.kind === 'capped') {
        if (capDecision.reason === 'adjacency') {
          askAdjacencyNudged = true;
        }
        analytics.wizardCapture('wizard_ask capped', {
          reason: capDecision.reason,
          call_count: askCallCount,
          max_questions: askMaxQuestions,
        });
        return {
          content: [{ type: 'text' as const, text: capDecision.message }],
          isError: true,
        };
      }

      // Validate that single/multi questions include options. The schema
      // alone can't enforce a per-kind requirement.
      for (const q of args.questions) {
        if (
          (q.kind === 'single' || q.kind === 'multi') &&
          (!q.options || q.options.length === 0)
        ) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: question "${q.id}" has kind="${q.kind}" but no options. Provide at least one { label, value } option, or change kind to "text".`,
              },
            ],
            isError: true,
          };
        }
        if (q.sensitive && q.kind !== 'text') {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: question "${q.id}" sets sensitive=true but kind="${q.kind}". Only kind="text" answers can be vaulted as secrets.`,
              },
            ],
            isError: true,
          };
        }
      }

      const ids = new Set<string>();
      for (const q of args.questions) {
        if (ids.has(q.id)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: duplicate question id "${q.id}". Each question must have a unique id.`,
              },
            ],
            isError: true,
          };
        }
        ids.add(q.id);
      }

      askCallCount += 1;

      try {
        const answers = await askBridge.request({ questions: args.questions });

        // A fully cancelled/timed-out ask (the user dismissed the overlay or let
        // it time out) shouldn't burn the per-run cap. Otherwise one cancellation
        // exhausts the budget for every remaining source and forces a deep-link
        // fallback even when the user was willing to answer. Refund the slot we
        // optimistically took so cancellation is free.
        if (isFullyCancelled(answers)) {
          askCallCount -= 1;
        }

        // For any question marked sensitive, move the raw answer into the
        // vault and replace it with an opaque ref before returning to the
        // agent — so the secret never enters the LLM conversation.
        const sensitiveById = new Map(
          args.questions
            .filter((q) => q.sensitive)
            .map((q) => [q.id, q.prompt]),
        );
        const sanitised: Record<
          string,
          string | string[] | { secretRef: string }
        > = {};
        for (const [id, answer] of Object.entries(answers)) {
          const label = sensitiveById.get(id);
          if (
            label !== undefined &&
            typeof answer === 'string' &&
            answer !== '__cancelled__'
          ) {
            const ref = secretVault.put(answer, {
              label,
              source: 'wizard_ask',
            });
            sanitised[id] = { secretRef: ref };
            logToFile(`wizard_ask: vaulted answer for "${id}" as ${ref}`);
          } else {
            sanitised[id] = answer;
          }
        }

        logToFile(
          `wizard_ask: resolved ${Object.keys(answers).length} answer(s) for ${
            args.questions.length
          } question(s)`,
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ answers: sanitised }, null, 2),
            },
          ],
        };
      } catch (err: any) {
        // A failed ask never reached the user, so it shouldn't burn the
        // per-run cap either — otherwise a transient bridge error eats the
        // budget for every remaining source.
        askCallCount -= 1;
        logToFile(`wizard_ask: error: ${err?.message ?? err}`);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: wizard_ask failed: ${err?.message ?? String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -- Assemble server ------------------------------------------------------

  const orchestratorTools = orchestrator
    ? buildOrchestratorTools(tool, orchestrator)
    : [];

  return createSdkMcpServer({
    name: SERVER_NAME,
    version: '1.0.0',
    tools: [
      checkEnvKeys,
      setEnvValues,
      detectPM,
      loadSkillMenu,
      installSkill,
      auditSeedChecks,
      auditAddChecks,
      auditResolveChecks,
      wizardAsk,
      ...orchestratorTools,
    ],
  });
}

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
