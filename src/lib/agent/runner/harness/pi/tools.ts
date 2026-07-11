/**
 * Wizard capabilities as pi custom tools (#5). pi does not mount MCP servers,
 * so the tools the wizard prompt depends on — skill discovery/install and
 * fenced `.env` edits — are exposed to pi as native `defineTool` tools backed
 * by the same helpers the claude-agent-sdk path uses (`fetchSkillMenu`,
 * `installSkillById`, `parseEnvKeys`, `mergeEnvValues`). Same tool names as the
 * MCP server so the shared prompt is unchanged.
 *
 * v1 covers the four tools a framework integration needs. `wizard_ask` is
 * interactive-only (disabled in CI) and the secret-vault `secretRef` path is a
 * follow-up — CI passes literal values.
 */

import fs from 'fs';
import path from 'path';
import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { logToFile } from '@utils/debug';
import {
  fetchSkillMenu,
  installSkillById,
  mergeEnvValues,
  parseEnvKeys,
  resolveEnvPath,
} from '@lib/wizard-tools';
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
}

export function createWizardPiTools(ctx: PiToolsContext): ToolDefinition[] {
  const { workingDirectory, skillsBaseUrl } = ctx;
  const detectPackageManager =
    ctx.detectPackageManager ?? detectNodePackageManagers;

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
        description: 'Path to the .env file, relative to the project root',
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
        description: 'Path to the .env file, relative to the project root',
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

  return [loadSkillMenu, installSkill, checkEnvKeys, setEnvValues, detectPm];
}
