/**
 * Skill pre-loader — installs and reads skill files before the agent starts.
 *
 * Eliminates the discovery stage by deterministically selecting, downloading,
 * and reading all skill content so it can be injected into the execution prompt.
 * The agent starts directly in execution mode with full skill context.
 */

import fs from 'fs';
import path from 'path';
import { fetchSkillMenu, downloadSkill, type SkillEntry } from './wizard-tools';
import { RunWorkArea, type WizardRunScope } from './run-scope';
import { logToFile } from '../utils/debug';

/** Maps work areas to skill menu categories. */
const WORK_AREA_SKILL_CATEGORIES: Record<RunWorkArea, string> = {
  [RunWorkArea.ProductAnalytics]: 'integration',
  [RunWorkArea.ErrorTracking]: 'error-tracking',
  [RunWorkArea.FeatureFlags]: 'feature-flags',
  [RunWorkArea.LlmAnalytics]: 'llm-analytics',
};

export interface PreloadedSkill {
  /** The skill entry from the menu */
  entry: SkillEntry;
  /** Category this skill belongs to */
  category: string;
  /** Content of SKILL.md */
  skillMd: string;
  /** Map of reference file path → content */
  references: Map<string, string>;
}

/**
 * Find the best matching skill for a framework in a given category.
 *
 * Matches by checking if the skill ID contains the integration name.
 * For example, integration "nextjs" matches skill "integration-nextjs-app-router".
 */
function findSkillForFramework(
  skills: SkillEntry[],
  integration: string,
): SkillEntry | null {
  // Exact prefix match first (e.g., "integration-nextjs" for integration "nextjs")
  const exactMatch = skills.find((s) => s.id.includes(`-${integration}`));
  if (exactMatch) return exactMatch;

  // Fallback: any skill in the category (for generic skills)
  return skills.length > 0 ? skills[0] : null;
}

/**
 * Read all files from an installed skill directory.
 */
function readSkillFiles(
  installDir: string,
  skillId: string,
): { skillMd: string; references: Map<string, string> } | null {
  const skillDir = path.join(installDir, '.claude', 'skills', skillId);
  const skillMdPath = path.join(skillDir, 'SKILL.md');

  let skillMd: string;
  try {
    skillMd = fs.readFileSync(skillMdPath, 'utf-8');
  } catch {
    return null;
  }

  const references = new Map<string, string>();
  const refsDir = path.join(skillDir, 'references');
  try {
    const refFiles = fs.readdirSync(refsDir).sort();
    for (const file of refFiles) {
      if (!file.endsWith('.md')) continue;
      try {
        const content = fs.readFileSync(path.join(refsDir, file), 'utf-8');
        references.set(file, content);
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // No references directory
  }

  return { skillMd, references };
}

/**
 * Pre-load all skills needed for the current run scope.
 *
 * Fetches the skill menu, selects the right skill per work area,
 * downloads and installs them, and reads all their files.
 */
export async function preloadSkills(
  installDir: string,
  skillsBaseUrl: string,
  integration: string,
  runScope: WizardRunScope,
): Promise<PreloadedSkill[]> {
  logToFile('[skill-preloader] Starting skill preload', {
    integration,
    workAreas: runScope.workAreas,
  });

  // Fetch skill menu
  const menu = await fetchSkillMenu(skillsBaseUrl);
  if (!menu) {
    logToFile('[skill-preloader] Failed to fetch skill menu');
    return [];
  }

  const preloaded: PreloadedSkill[] = [];

  for (const workArea of runScope.workAreas) {
    const category = WORK_AREA_SKILL_CATEGORIES[workArea];
    const skills = menu.categories[category];
    if (!skills || skills.length === 0) {
      logToFile(`[skill-preloader] No skills found for category: ${category}`);
      continue;
    }

    const skill = findSkillForFramework(skills, integration);
    if (!skill) {
      logToFile(
        `[skill-preloader] No matching skill for ${integration} in ${category}`,
      );
      continue;
    }

    // Check if already installed
    const existingFiles = readSkillFiles(installDir, skill.id);
    if (existingFiles) {
      logToFile(
        `[skill-preloader] Skill ${skill.id} already installed, reusing`,
      );
      preloaded.push({
        entry: skill,
        category,
        skillMd: existingFiles.skillMd,
        references: existingFiles.references,
      });
      continue;
    }

    // Download and install
    logToFile(`[skill-preloader] Installing skill: ${skill.id}`);
    const result = downloadSkill(skill, installDir);
    if (!result.success) {
      logToFile(
        `[skill-preloader] Failed to install ${skill.id}: ${result.error}`,
      );
      continue;
    }

    // Read installed files
    const files = readSkillFiles(installDir, skill.id);
    if (!files) {
      logToFile(`[skill-preloader] Failed to read installed skill ${skill.id}`);
      continue;
    }

    preloaded.push({
      entry: skill,
      category,
      skillMd: files.skillMd,
      references: files.references,
    });
  }

  logToFile(
    `[skill-preloader] Preloaded ${preloaded.length} skill(s): ${preloaded
      .map((s) => s.entry.id)
      .join(', ')}`,
  );
  return preloaded;
}

/**
 * Format preloaded skills into prompt context that replaces the discovery stage.
 *
 * Includes SKILL.md and all workflow reference files so the agent has
 * everything it needs to start executing immediately.
 */
export function formatSkillsForPrompt(skills: PreloadedSkill[]): string {
  if (skills.length === 0) return '';

  const sections: string[] = [
    'The following PostHog skills have been pre-installed. Their content is provided below so you can start implementing immediately without calling load_skill_menu or install_skill.',
    '',
  ];

  for (const skill of skills) {
    sections.push(`--- Skill: ${skill.entry.id} (${skill.category}) ---`);
    sections.push('');
    sections.push('SKILL.md:');
    sections.push(skill.skillMd);
    sections.push('');

    // Include workflow files (numbered files that guide implementation)
    const workflowFiles = [...skill.references.entries()]
      .filter(
        ([name]) => /^\d+\.\d+-/.test(name) || /^[a-z]+-\d+\.\d+-/.test(name),
      )
      .sort(([a], [b]) => a.localeCompare(b));

    if (workflowFiles.length > 0) {
      sections.push('Workflow reference files (follow in order):');
      sections.push('');
      for (const [name, content] of workflowFiles) {
        sections.push(`=== ${name} ===`);
        sections.push(content);
        sections.push('');
      }
    }

    // Include example files
    const exampleFiles = [...skill.references.entries()]
      .filter(([name]) => name.toUpperCase().startsWith('EXAMPLE'))
      .sort(([a], [b]) => a.localeCompare(b));

    if (exampleFiles.length > 0) {
      sections.push('Example reference files:');
      sections.push('');
      for (const [name, content] of exampleFiles) {
        sections.push(`=== ${name} ===`);
        sections.push(content);
        sections.push('');
      }
    }

    sections.push('--- End skill ---');
    sections.push('');
  }

  return sections.join('\n');
}
