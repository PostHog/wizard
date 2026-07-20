/**
 * MCP facade over `./tools` — the unified in-process server the anthropic
 * harness mounts. Declarations (zod schemas, descriptions) and the MCP result
 * envelope live here; all behavior is imported from the shared core.
 *
 * Provides: check_env_keys, set_env_values, detect_package_manager,
 * load_skill_menu / install_skill, audit_* ledger tools, wizard_ask, and the
 * orchestrator queue tools. Secret values never leave the machine.
 */

import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { logToFile } from '@utils/debug';
import { analytics } from '@utils/analytics';
import { makeMutex } from '@utils/atomic-ledger';
import type { PackageManagerDetector } from '../detection/package-manager';
import {
  AUDIT_CHECKS_FILE,
  type AuditCheck,
  type AuditStatus,
} from '../programs/audit/types';
import { type WizardAskBridge, isFullyCancelled } from '../wizard-ask-bridge';
import { createSecretVault, type SecretVault } from '../secret-vault';
import {
  buildOrchestratorTools,
  type OrchestratorToolsContext,
} from '../agent/runner/sequence/orchestrator/queue-tools';
import {
  DEFAULT_ASK_MAX_QUESTIONS,
  ENV_FILE_PATH_DESCRIPTION,
  SERVER_NAME,
  appendAuditChecksToLedger,
  applyAuditUpdates,
  downloadSkill,
  ensureGitignoreCoverage,
  evaluateAskCap,
  fetchSkillMenu,
  mergeEnvValues,
  parseEnvKeys,
  readLedger,
  resolveEnvPath,
  resolveEnvSecretRefs,
  vaultSensitiveAnswers,
  writeLedgerAtomic,
  type SkillEntry,
  AUDIT_STATUSES,
} from './tools';

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
// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

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
      const resolution = resolveEnvSecretRefs(args.values, secretVault);
      if (!resolution.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: secret reference "${resolution.secretRef}" for key "${resolution.key}" is not known to the vault. The ref may have expired, been minted in a different run, or been mistyped.`,
            },
          ],
          isError: true,
        };
      }
      const { values: resolvedValues, refKeys: resolvedRefKeys } = resolution;

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

        // Sensitive answers go to the vault; the agent sees an opaque ref.
        const sanitised = vaultSensitiveAnswers(
          args.questions,
          answers,
          secretVault,
        );

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
