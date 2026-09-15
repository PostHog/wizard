import fs from 'fs/promises';
import path from 'path';
import { getSkillsBaseUrl, POSTHOG_DOCS_URL } from './constants';
import type { ProgramConfig } from './programs/program-step';
import type { AgentRunContext } from './wizard-session';
import {
  downloadSkill,
  fetchSkillMenu,
  type SkillEntry,
  type SkillMenu,
} from './wizard-tools/tools';

export type WizardSpellbook = { path: string; skillsIncluded: boolean };
type SpellbookSession = Omit<AgentRunContext, 'programId'>;

function selectSkills(
  menu: SkillMenu,
  session: SpellbookSession,
  program: ProgramConfig,
): SkillEntry[] {
  const entries = Object.values(menu.categories)
    .flat()
    .filter((entry) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id));
  const skillId = program.skillId ?? session.skillId;
  const exact = entries.find((entry) => entry.id === skillId);
  if (exact) return [exact];

  const framework = session.integration;
  const referenceGroup = skillId === framework ? 'integration' : skillId;
  const references = entries.filter(
    (entry) => entry.group === referenceGroup && entry.framework === framework,
  );
  const reference = references.find((entry) => entry.default) ?? references[0];
  if (reference) return [reference];

  const flow = program.agentFlow ?? program.id;
  const groups = new Map<string, SkillEntry>();
  for (const entry of entries) {
    const group = entry.group;
    if (
      !group ||
      (group !== flow && !group.startsWith(`${flow}-`)) ||
      (entry.framework && entry.framework !== framework)
    ) {
      continue;
    }
    if (!groups.has(group) || entry.default) groups.set(group, entry);
  }
  return [...groups.values()];
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
      triage: undefined,
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
