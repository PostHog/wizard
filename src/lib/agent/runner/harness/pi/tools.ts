/**
 * Wizard capabilities as pi custom tools (#5). pi does not mount MCP servers,
 * so the tools the wizard prompt depends on — skill discovery/install and
 * fenced `.env` edits — are exposed to pi as native `defineTool` tools backed
 * by the same helpers the claude-agent-sdk path uses (`fetchSkillMenu`,
 * `installSkillById`, `parseEnvKeys`, `mergeEnvValues`). Same tool names as the
 * MCP server so the shared prompt is unchanged. `wizard_ask` is wired here too
 * (same schema, caps, and askBridge as the MCP tool) so interactive programs
 * can interview the user on pi; without a bridge (CI) it errors on call.
 */

import fs from 'fs';
import path from 'path';
import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import {
  DEFAULT_ASK_MAX_QUESTIONS,
  ENV_FILE_PATH_DESCRIPTION,
  WIZARD_TOOL_NAMES,
  evaluateAskCap,
  fetchSkillMenu,
  installSkillById,
  mergeEnvValues,
  parseEnvKeys,
  resolveEnvPath,
} from '@lib/wizard-tools';
import { isFullyCancelled, type WizardAskBridge } from '@lib/wizard-ask-bridge';
import { withMode } from './index';
import {
  detectNodePackageManagers,
  type PackageManagerDetector,
} from '@lib/detection/package-manager';

function text(s: string): {
  content: [{ type: 'text'; text: string }];
  details: unknown;
} {
  return { content: [{ type: 'text', text: s }], details: {} };
}

export interface PiToolsContext {
  workingDirectory: string;
  skillsBaseUrl: string;
  /** Framework's package-manager detector. Defaults to Node detection. */
  detectPackageManager?: PackageManagerDetector;
  /** Drives the `wizard_ask` overlay. Omitted in CI → the tool errors on call. */
  askBridge?: WizardAskBridge;
  /** Per-run cap on wizard_ask calls. Defaults to {@link DEFAULT_ASK_MAX_QUESTIONS}. */
  maxQuestions?: number;
  /** Overlay open/closed signal — the security gate blocks Write/Edit while open. */
  onAskPendingChange?: (pending: boolean) => void;
  /** Program disallow list; gates wizard_ask here since pi tools carry bare names the MCP-prefixed security gate misses. */
  disallowedTools?: readonly string[];
}

export function createWizardPiTools(ctx: PiToolsContext): ToolDefinition[] {
  const { workingDirectory, skillsBaseUrl, askBridge, onAskPendingChange } =
    ctx;
  const detectPackageManager =
    ctx.detectPackageManager ?? detectNodePackageManagers;
  const askMaxQuestions = ctx.maxQuestions ?? DEFAULT_ASK_MAX_QUESTIONS;
  // Per-run wizard_ask accounting (total cap + one-time adjacency nudge),
  // mirroring the MCP server's counters.
  let askCallCount = 0;
  let askAdjacencyNudged = false;

  // Fetch the skill menu at most once per run — the agent calls load_skill_menu
  // 2-3× otherwise, each a fresh HTTP round-trip (profiled slowness).
  let menuPromise: ReturnType<typeof fetchSkillMenu> | undefined;
  const getSkillMenu = () => (menuPromise ??= fetchSkillMenu(skillsBaseUrl));

  const loadSkillMenu = defineTool({
    name: 'load_skill_menu',
    label: 'Load skill menu',
    description:
      'Load available PostHog skills for a category. Returns skill IDs and names. Call this first, then install_skill with the chosen ID.',
    promptSnippet:
      'load_skill_menu(category) — list installable PostHog skills',
    parameters: Type.Object({
      category: Type.String({
        description: 'Skill category, e.g. "integration"',
      }),
    }),
    async execute(_id, args) {
      const menu = await getSkillMenu();
      if (!menu) return text('Error: could not load the skill menu.');
      const skills = menu.categories[args.category] ?? [];
      if (skills.length === 0) {
        return text(`No skills found for category "${args.category}".`);
      }
      logToFile(`[pi] load_skill_menu: ${skills.length} skills`);
      return text(skills.map((s) => `- ${s.id}: ${s.name}`).join('\n'));
    },
  });

  const installSkill = defineTool({
    name: 'install_skill',
    label: 'Install skill',
    description:
      'Download and install a PostHog skill by ID into .claude/skills/<skillId>/. Call load_skill_menu first. Then read the installed SKILL.md and follow it.',
    promptSnippet:
      'install_skill(skillId) — install a skill, then read its SKILL.md',
    parameters: Type.Object({
      skillId: Type.String({ description: 'Skill ID from load_skill_menu' }),
    }),
    async execute(_id, args) {
      const result = await installSkillById(
        args.skillId,
        workingDirectory,
        skillsBaseUrl,
      );
      if (result.kind !== 'ok') {
        logToFile(`[pi] install_skill ${args.skillId}: ${result.kind}`);
        return text(
          `Error installing skill "${args.skillId}": ${result.kind}. Use load_skill_menu to see valid IDs.`,
        );
      }
      logToFile(`[pi] install_skill ${args.skillId} -> ${result.path}`);
      return text(
        `Installed "${args.skillId}" at ${result.path}. Read ${result.path}/SKILL.md and follow it.`,
      );
    },
  });

  const checkEnvKeys = defineTool({
    name: 'check_env_keys',
    label: 'Check env keys',
    description:
      'Check which environment variable keys are present or missing in a .env file. Never reveals values.',
    promptSnippet: 'check_env_keys(filePath, keys) — see which .env keys exist',
    parameters: Type.Object({
      filePath: Type.String({
        description: ENV_FILE_PATH_DESCRIPTION,
      }),
      keys: Type.Array(Type.String(), {
        description: 'Environment variable key names to check',
      }),
    }),
    async execute(_id, args) {
      const resolved = resolveEnvPath(workingDirectory, args.filePath);
      const existing = fs.existsSync(resolved)
        ? parseEnvKeys(await fs.promises.readFile(resolved, 'utf8'))
        : new Set<string>();
      const results: Record<string, 'present' | 'missing'> = {};
      for (const key of args.keys) {
        results[key] = existing.has(key) ? 'present' : 'missing';
      }
      return text(JSON.stringify(results, null, 2));
    },
  });

  const setEnvValues = defineTool({
    name: 'set_env_values',
    label: 'Set env values',
    description:
      'Create or update environment variable keys in a .env file (creates the file if missing). Pass literal string values.',
    promptSnippet:
      'set_env_values(filePath, values) — write .env keys (never hardcode secrets in source)',
    parameters: Type.Object({
      filePath: Type.String({
        description: ENV_FILE_PATH_DESCRIPTION,
      }),
      values: Type.Record(Type.String(), Type.String(), {
        description: 'Key → literal value',
      }),
    }),
    async execute(_id, args) {
      const forbidden = Object.keys(args.values).find(
        (k) => k.toUpperCase() === 'POSTHOG_KEY',
      );
      if (forbidden) {
        return text(
          `Error: "${forbidden}" is not a valid PostHog env var name. Use the framework-specific key (e.g. NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN).`,
        );
      }
      const resolved = resolveEnvPath(workingDirectory, args.filePath);
      const existing = fs.existsSync(resolved)
        ? await fs.promises.readFile(resolved, 'utf8')
        : '';
      const merged = mergeEnvValues(existing, args.values);
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir))
        await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(resolved, merged, 'utf8');
      logToFile(
        `[pi] set_env_values: ${resolved} keys=${Object.keys(args.values).join(
          ',',
        )}`,
      );
      return text(
        `Wrote ${Object.keys(args.values).length} key(s) to ${args.filePath}.`,
      );
    },
  });

  const detectPm = defineTool({
    name: 'detect_package_manager',
    label: 'Detect package manager',
    description:
      "Detect the project's package manager(s). Returns the name and the install command for each. Call this before installing a dependency, then RUN the returned install command (with the posthog package) via bash — the SDK package must end up in the project manifest, or the app will not build.",
    promptSnippet:
      'detect_package_manager() — find the PM + install command, then run it via bash to add the SDK',
    parameters: Type.Object({}),
    async execute() {
      const result = await detectPackageManager(workingDirectory);
      logToFile(
        `[pi] detect_package_manager: ${result.detected.length} detected`,
      );
      return text(JSON.stringify(result, null, 2));
    },
  });

  // Native mirror of the MCP `wizard_ask` tool: same name, schema, and
  // askBridge, so the shared prompt is unchanged.
  const wizardAsk = defineTool({
    name: 'wizard_ask',
    label: 'Ask the user',
    description:
      'Ask the user one or more structured questions and wait for their answers. ' +
      'Use this whenever you would otherwise inline a question in your text output. ' +
      'Batch related questions into a single call (up to 8) rather than asking one at ' +
      'a time; sequential calls are fine when later questions genuinely depend on ' +
      'earlier answers. A fully cancelled or timed-out response does NOT count against ' +
      'the per-run cap — treat it as "the user declined" and fall back gracefully.',
    promptSnippet:
      'wizard_ask(questions) — ask the user structured questions and wait for answers',
    parameters: Type.Object({
      questions: Type.Array(
        Type.Object({
          id: Type.String({
            description: 'Stable key for the answer in the response map',
          }),
          prompt: Type.String({
            description: 'Question text shown to the user',
          }),
          kind: Type.Union(
            [
              Type.Literal('single'),
              Type.Literal('multi'),
              Type.Literal('text'),
            ],
            {
              description:
                "'single' = pick one option, 'multi' = pick any, 'text' = free-form single-line answer",
            },
          ),
          options: Type.Optional(
            Type.Array(
              Type.Object({
                label: Type.String(),
                value: Type.String(),
                description: Type.Optional(Type.String()),
              }),
              {
                description:
                  'Required for kind=single|multi; ignored for kind=text',
              },
            ),
          ),
          required: Type.Optional(
            Type.Boolean({ description: 'Defaults to true' }),
          ),
          sensitive: Type.Optional(
            Type.Boolean({
              description:
                'Not supported on this harness: sensitive questions are rejected (no secret vault yet). Collect secrets via a browser/connect link instead of chat.',
            }),
          ),
        }),
        { minItems: 1, maxItems: 8 },
      ),
    }),
    async execute(_id, args) {
      if (!askBridge) {
        return text(
          'Error: wizard_ask is not available in this environment (CI / non-interactive). Proceed with sensible defaults or emit [ABORT] requirements-incomplete.',
        );
      }

      const cap = evaluateAskCap(
        askCallCount,
        askMaxQuestions,
        askAdjacencyNudged,
      );
      if (cap.kind === 'capped') {
        if (cap.reason === 'adjacency') askAdjacencyNudged = true;
        logToFile(
          `[pi] wizard_ask capped: reason=${cap.reason} count=${askCallCount}`,
        );
        analytics.wizardCapture('wizard_ask capped', {
          reason: cap.reason,
          call_count: askCallCount,
          max_questions: askMaxQuestions,
        });
        return text(cap.message);
      }

      // The schema can't enforce per-kind requirements or unique ids.
      const ids = new Set<string>();
      for (const q of args.questions) {
        if ((q.kind === 'single' || q.kind === 'multi') && !q.options?.length) {
          return text(
            `Error: question "${q.id}" has kind="${q.kind}" but no options. Provide at least one { label, value }, or use kind="text".`,
          );
        }
        // Fail closed: pi has no secret-vault wiring yet, so a sensitive
        // answer would enter the model conversation literally. Reject until
        // the vault is wired (the MCP path already vaults via secretRef).
        if (q.sensitive) {
          return text(
            `Error: question "${q.id}" sets sensitive=true, but sensitive answers are not supported on this harness yet. Do not collect the secret in chat — point the user at a browser/connect link instead.`,
          );
        }
        if (ids.has(q.id)) {
          return text(
            `Error: duplicate question id "${q.id}". Each question needs a unique id.`,
          );
        }
        ids.add(q.id);
      }

      // Optimistically take the slot; refund it on a cancellation or a bridge
      // error so a declined/failed ask doesn't burn the budget for later ones.
      askCallCount += 1;
      // Block Write/Edit for as long as the overlay is open, so the agent can't
      // mutate files while it's waiting on the user's answer.
      onAskPendingChange?.(true);
      try {
        const answers = await askBridge.request({ questions: args.questions });
        if (isFullyCancelled(answers)) askCallCount -= 1;
        logToFile(
          `[pi] wizard_ask: resolved ${
            Object.keys(answers).length
          } answer(s) for ${args.questions.length} question(s)`,
        );
        return text(JSON.stringify({ answers }, null, 2));
      } catch (err) {
        askCallCount -= 1;
        const message = err instanceof Error ? err.message : String(err);
        logToFile(`[pi] wizard_ask: error: ${message}`);
        return text(`Error: wizard_ask failed: ${message}`);
      } finally {
        onAskPendingChange?.(false);
      }
    },
  });

  const tools = [
    loadSkillMenu,
    installSkill,
    checkEnvKeys,
    setEnvValues,
    detectPm,
  ];
  // Register wizard_ask only when the program allows it. posthog-integration
  // disallows it (runs without structured user input); self-driving keeps it.
  // Sequential: the ask bridge holds a single in-flight question slot, so a
  // batched turn must never dispatch two asks (or an ask + a write) at once.
  const askDisallowed =
    ctx.disallowedTools?.includes(WIZARD_TOOL_NAMES.wizardAsk) ?? false;
  if (!askDisallowed) tools.push(withMode(wizardAsk, 'sequential'));
  return tools;
}
