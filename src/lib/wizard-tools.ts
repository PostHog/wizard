/**
 * Unified in-process MCP server for the PostHog wizard.
 *
 * Provides tools that run locally (secret values never leave the machine):
 * - check_env_keys: Check which env var keys exist in a .env file
 * - set_env_values: Create/update env vars in a .env file
 * - detect_package_manager: Detect the project's package manager(s)
 * - load_skill_menu / install_skill: Skill installation
 * - prompt_user: Ask the user a question via a wizard TUI modal
 * - audit_seed_checks / audit_add_checks / audit_resolve_checks: Audit ledger ownership
 */

import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { z } from 'zod';
import { logToFile } from '../utils/debug';
import { getUI } from '../ui';
import { skillTmpPath } from '../utils/paths';
import type { PackageManagerDetector } from './detection/package-manager';
import {
  AUDIT_CHECKS_FILE,
  coerceAuditChecks,
  type AuditCheck,
  type AuditStatus,
} from './workflows/audit/types';
import { ALL_AUDIT_AREAS, type AuditArea } from './workflows/audit/areas';

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

export type SkillEntry = { id: string; name: string; downloadUrl: string };

export interface SkillMenu {
  categories: Record<string, SkillEntry[]>;
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
): Promise<SkillMenu | null> {
  try {
    const menuUrl = `${skillsBaseUrl}/skill-menu.json`;
    logToFile(`fetchSkillMenu: fetching from ${menuUrl}`);
    const resp = await fetch(menuUrl);
    if (resp.ok) {
      const data = (await resp.json()) as SkillMenu;
      logToFile(
        `fetchSkillMenu: loaded (${
          Object.keys(data.categories).length
        } categories)`,
      );
      return data;
    }
    logToFile(`fetchSkillMenu: failed with HTTP ${resp.status}`);
    return null;
  } catch (err: any) {
    logToFile(`fetchSkillMenu: error: ${err.message}`);
    return null;
  }
}

/**
 * Download and extract a skill.
 * By default installs to `<installDir>/.claude/skills/<id>/`.
 * Pass `skillsRoot` to override the base directory (e.g. `.posthog/skills`).
 */
export function downloadSkill(
  skillEntry: SkillEntry,
  installDir: string,
  skillsRoot?: string,
): { success: boolean; error?: string } {
  const skillDir = skillsRoot
    ? path.join(installDir, skillsRoot, skillEntry.id)
    : path.join(installDir, '.claude', 'skills', skillEntry.id);
  const tmpFile = skillTmpPath(skillEntry.id);

  try {
    fs.mkdirSync(skillDir, { recursive: true });
    execFileSync('curl', ['-sL', skillEntry.downloadUrl, '-o', tmpFile], {
      timeout: 30000,
    });
    execFileSync('unzip', ['-o', tmpFile, '-d', skillDir], {
      timeout: 30000,
    });
    fs.writeFileSync(path.join(skillDir, '.posthog-wizard'), '');
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* ignore cleanup errors */
    }

    logToFile(
      `downloadSkill: installed ${skillEntry.id} from ${skillEntry.downloadUrl}`,
    );
    return { success: true };
  } catch (err: any) {
    logToFile(`downloadSkill: error: ${err.message}`);
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
 * finds the skill, downloads and extracts it. Workflows should use this
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

  const result = downloadSkill(skill, installDir, skillsRoot);
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
   * Audit-only: subset of audit areas the run is constrained to.
   * Surfaced via the `audit_get_areas` MCP tool. Omit / pass `[]` for
   * an unconstrained run.
   */
  auditAreas?: ReadonlyArray<AuditArea>;
}

// ---------------------------------------------------------------------------
// Env file helpers
// ---------------------------------------------------------------------------

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

/**
 * Atomically write JSON: write to .tmp then rename. The rename is what bumps
 * the file's mtime, which is what the UI's file watcher polls on.
 */
function writeLedgerAtomic(targetPath: string, checks: AuditCheck[]): void {
  const tmpPath = `${targetPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(checks, null, 2), 'utf8');
  fs.renameSync(tmpPath, targetPath);
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

/**
 * Single async mutex shared by audit tools — guarantees a read-modify-write
 * cycle on the ledger is atomic across concurrent tool calls (e.g. future subagents).
 */
function makeMutex() {
  let chain: Promise<unknown> = Promise.resolve();
  return async function run<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = chain.then(() => fn());
    chain = next.catch(() => undefined);
    return next;
  };
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
  const { workingDirectory, detectPackageManager, skillsBaseUrl } = options;
  const auditAreas: ReadonlyArray<AuditArea> = options.auditAreas ?? [];
  const sdk = await getSDKModule();
  const { tool, createSdkMcpServer } = sdk;

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
      filePath: z
        .string()
        .describe('Path to the .env file, relative to the project root'),
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
    'Create or update environment variable keys in a .env file. Creates the file if it does not exist. Ensures .gitignore coverage.',
    {
      filePath: z
        .string()
        .describe('Path to the .env file, relative to the project root'),
      values: z
        .record(z.string(), z.string())
        .describe('Key-value pairs to set'),
    },
    (args: { filePath: string; values: Record<string, string> }) => {
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

      const resolved = resolveEnvPath(workingDirectory, args.filePath);
      logToFile(
        `set_env_values: ${resolved}, keys: ${Object.keys(args.values).join(
          ', ',
        )}`,
      );

      const existing = fs.existsSync(resolved)
        ? fs.readFileSync(resolved, 'utf8')
        : '';
      const content = mergeEnvValues(existing, args.values);

      // Ensure parent directory exists
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
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
    (args: { skillId: string }) => {
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

      const result = downloadSkill(skill, workingDirectory);
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

  // -- prompt_user ----------------------------------------------------------

  const promptUser = tool(
    'prompt_user',
    `Ask the user a question via a modal in the wizard TUI. Use this at decision points where the user owns the choice (picking targets, choosing among options, supplying a value). The call blocks until the user answers; the answer is returned as a JSON-encoded string in the tool result text.

Modes and example invocations:

- mode "single" — pick exactly one option:
  { "title": "Which env file?", "message": "Where should we write keys?", "mode": "single", "options": [{ "label": ".env.local", "value": ".env.local" }, { "label": ".env", "value": ".env" }] }
  Returns the chosen value as a JSON string, e.g. "\\".env.local\\"".

- mode "multi" — pick zero or more options:
  { "title": "Select migration targets", "message": "Pick the ones you want to migrate.", "mode": "multi", "options": [{ "label": "LaunchDarkly", "value": "launchdarkly" }, { "label": "Amplitude", "value": "amplitude" }] }
  Returns a JSON array of selected values, e.g. "[\\"launchdarkly\\"]" or "[]".

- mode "text" — free-form text input:
  { "title": "Project name", "message": "Enter a name for this project.", "mode": "text", "placeholder": "my-project" }
  Returns the entered text as a JSON string, e.g. "\\"my-project\\"".

Required: title, message, mode. options[] is required for single/multi and ignored for text. placeholder is text-only and optional. Always pass a clear title and message — the user sees them verbatim.`,
    {
      title: z.string().describe('Modal heading shown to the user.'),
      message: z
        .string()
        .describe('Question or prompt body shown above the input.'),
      mode: z
        .enum(['single', 'multi', 'text'])
        .describe(
          "'single' = pick one option, 'multi' = pick zero or more options, 'text' = free-form text input.",
        ),
      options: z
        .array(
          z.object({
            label: z.string(),
            value: z.string(),
            hint: z.string().optional(),
          }),
        )
        .optional()
        .describe(
          'Required for single/multi modes. Each entry: { label: human-readable text, value: machine id returned to you, hint?: short trailing context shown in parentheses next to the label }. Ignored in text mode.',
        ),
      placeholder: z
        .string()
        .optional()
        .describe('Placeholder shown inside the text input. text mode only.'),
    },
    async (args: {
      title: string;
      message: string;
      mode: 'single' | 'multi' | 'text';
      options?: { label: string; value: string }[];
      placeholder?: string;
    }) => {
      if (
        (args.mode === 'single' || args.mode === 'multi') &&
        (!args.options || args.options.length === 0)
      ) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: prompt_user requires non-empty options for single/multi mode.',
            },
          ],
          isError: true,
        };
      }

      logToFile(`prompt_user: mode=${args.mode}, title="${args.title}"`);
      try {
        const answer = await getUI().showUserPrompt(args);
        logToFile(`prompt_user: answer=${JSON.stringify(answer)}`);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(answer) }],
        };
      } catch (err: any) {
        logToFile(`prompt_user: error=${err?.message ?? err}`);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${err?.message ?? 'prompt_user failed'}`,
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

  // -- audit_get_areas ------------------------------------------------------

  const auditGetAreas = tool(
    'audit_get_areas',
    `Return the audit areas the wizard is constraining this run to. An empty array means the run is unconstrained — the agent should run every area its discovery determines applies. When non-empty, the agent must skip any area not in the list. Allowed values (canonical capitalization): ${ALL_AUDIT_AREAS.join(
      ', ',
    )}.`,
    {},
    () => {
      logToFile(
        `audit_get_areas: returning ${auditAreas.length} area(s)${
          auditAreas.length > 0 ? ` [${auditAreas.join(', ')}]` : ''
        }`,
      );
      return Promise.resolve({
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              areas: [...auditAreas],
              allowed: [...ALL_AUDIT_AREAS],
              constrained: auditAreas.length > 0,
            }),
          },
        ],
      });
    },
  );

  // -- Assemble server ------------------------------------------------------

  return createSdkMcpServer({
    name: SERVER_NAME,
    version: '1.0.0',
    tools: [
      checkEnvKeys,
      setEnvValues,
      detectPM,
      loadSkillMenu,
      installSkill,
      promptUser,
      auditSeedChecks,
      auditAddChecks,
      auditResolveChecks,
      auditGetAreas,
    ],
  });
}

/** Tool names exposed by the wizard-tools server, for use in allowedTools */
export const WIZARD_TOOL_NAMES = [
  `${SERVER_NAME}:check_env_keys`,
  `${SERVER_NAME}:set_env_values`,
  `${SERVER_NAME}:detect_package_manager`,
  `${SERVER_NAME}:load_skill_menu`,
  `${SERVER_NAME}:install_skill`,
  `${SERVER_NAME}:prompt_user`,
  `${SERVER_NAME}:audit_seed_checks`,
  `${SERVER_NAME}:audit_add_checks`,
  `${SERVER_NAME}:audit_resolve_checks`,
  `${SERVER_NAME}:audit_get_areas`,
];

// ---------------------------------------------------------------------------
// Test-only exports
// ---------------------------------------------------------------------------

export const __test = {
  writeLedgerAtomic,
  readLedger,
  applyAuditAdditions,
  appendAuditChecksToLedger,
  applyAuditUpdates,
  makeMutex,
  AUDIT_CHECKS_FILE,
};
