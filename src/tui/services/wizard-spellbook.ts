import fs from 'fs/promises';
import path from 'path';
import { getSkillsBaseUrl, POSTHOG_DOCS_URL } from '@shared/constants';
import type { ProgramConfig, WizardSession } from '@programs/types';
import { scanInstalledSkill } from '@programs';
import { downloadSkill } from '@shared/skill-install';
import {
  fetchSkillMenu,
  type SkillEntry,
  type SkillMenu,
} from '@shared/skill-menu';
import {
  DEFAULT_SKILL_TAG,
  FRAMEWORK_KEY,
  resolveSkill,
  skillTags,
} from '@shared/skill-resolution';

export type WizardSpellbook = { path: string; skillsIncluded: boolean };
type SpellbookSession = Pick<
  WizardSession,
  'installDir' | 'integration' | 'skillId' | 'frameworkConfig'
>;

/** The skills handed over: the program's own, else the framework's pack, else every skill of the program's flow. */
function selectSkills(
  menu: SkillMenu,
  session: SpellbookSession,
  program: ProgramConfig,
): SkillEntry[] {
  const entries = Object.values(menu.categories)
    .flat()
    .filter((entry) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id));
  const skillId = program.skillId ?? session.skillId;
  const framework = session.integration;
  // A skill id that is the framework's own names the framework's pack.
  const name = skillId === framework ? 'integration' : skillId;
  const picked =
    name &&
    resolveSkill(entries, name, {
      [FRAMEWORK_KEY]: framework ? [framework] : undefined,
    });
  if (picked) return [picked];

  const flow = program.agentFlow ?? program.id;
  const families = new Map<string, SkillEntry>();
  for (const entry of entries) {
    const { family } = entry;
    const tags = skillTags(entry);
    const frameworks = [...tags].filter((tag) =>
      tag.startsWith(`${FRAMEWORK_KEY}:`),
    );
    if (
      !family ||
      (family !== flow && !family.startsWith(`${flow}-`)) ||
      (frameworks.length > 0 &&
        !frameworks.includes(`${FRAMEWORK_KEY}:${framework}`))
    ) {
      continue;
    }
    if (!families.has(family) || tags.has(DEFAULT_SKILL_TAG)) {
      families.set(family, entry);
    }
  }
  return [...families.values()];
}

function spellbookText(
  session: SpellbookSession,
  program: ProgramConfig,
  skills: SkillEntry[],
): string {
  const framework = session.frameworkConfig?.metadata;
  const runDocs =
    typeof program.run === 'object' ? program.run.docsUrl : undefined;
  const docs = [
    ...new Set([framework?.docsUrl, runDocs, POSTHOG_DOCS_URL]),
  ].filter((url): url is string => Boolean(url));

  return [
    '# Wizard spell book',
    '',
    'Complete this task in the project containing this spell book:',
    '',
    program.description,
    '',
    `Wizard program: ${program.id}`,
    ...(framework ? [`Detected framework: ${framework.name}`] : []),
    '',
    'Inspect the existing project and its instructions before making changes. Check what has already been done, complete the requested task within its stated scope, then run the relevant checks and explain any remaining manual steps.',
    '',
    'Use your own coding agent and its authentication. The Wizard could not continue its inference session. No Wizard credentials are included; ask the user for any credentials the task requires and keep them out of source code.',
    '',
    '## Setup instructions',
    '',
    ...(skills.length
      ? [
          'Read the downloaded skills and their referenced files:',
          '',
          ...skills.map(
            (skill) => `- [${skill.id}](skills/${skill.id}/SKILL.md)`,
          ),
          '',
          'Downloaded skills may cover only part of the task. Use the official documentation below to fill any gaps.',
        ]
      : [
          'No matching skills could be downloaded. Use the official documentation below to complete the task.',
        ]),
    '',
    '## Official documentation',
    '',
    ...docs.map((url) => `- ${url}`),
    '',
  ].join('\n');
}

export async function writeWizardSpellbook(
  session: SpellbookSession,
  program: ProgramConfig,
): Promise<WizardSpellbook> {
  const parent = path.join(session.installDir, '.posthog');
  await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(parent, 'wizard-spellbook-'));
  const readme = path.join(directory, 'README.md');
  await fs.writeFile(readme, spellbookText(session, program, []));

  const menu = await fetchSkillMenu(getSkillsBaseUrl(), {
    timeoutMs: 10_000,
    maxAttempts: 1,
  });
  const installed: SkillEntry[] = [];
  for (const skill of menu ? selectSkills(menu, session, program) : []) {
    const result = await downloadSkill(skill, directory, {
      skillsRoot: 'skills',
      // No gateway here, so a flagged skill fails closed.
      scan: (dir) => scanInstalledSkill(dir, undefined),
    });
    if (result.success) {
      installed.push(skill);
    } else {
      await fs.rm(path.join(directory, 'skills', skill.id), {
        recursive: true,
        force: true,
      });
    }
  }
  await fs.writeFile(readme, spellbookText(session, program, installed));
  return { path: readme, skillsIncluded: installed.length > 0 };
}
