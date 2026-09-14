/**
 * The spell book: a README plus the run's context-mill skills, saved into the
 * project when the gateway mint fails so the user's own coding agent can
 * finish the task. No wizard credentials are written.
 */

import fs from 'fs/promises';
import path from 'path';
import { getSkillsBaseUrl, POSTHOG_DOCS_URL } from './constants';
import { getProgramConfig } from './programs/program-registry';
import type { WizardSession } from './wizard-session';
import {
  downloadSkill,
  fetchSkillMenu,
  type SkillEntry,
} from './wizard-tools/tools';

export type WizardSpellbook = { path: string; skillsIncluded: boolean };

function selectSkill(
  entries: SkillEntry[],
  skillId: string,
  framework: string | null,
): SkillEntry | undefined {
  const exact = entries.find((e) => e.id === skillId);
  if (exact) return exact;
  if (!framework) return undefined;
  const family = entries.filter(
    (e) => e.group === skillId && e.framework === framework,
  );
  return family.find((e) => e.default) ?? family[0];
}

export async function writeWizardSpellbook(
  session: WizardSession,
): Promise<WizardSpellbook> {
  const program = getProgramConfig(
    (session.programLabel ?? 'posthog-integration') as never,
  );
  const directory = await fs.mkdtemp(
    path.join(session.installDir, '.posthog', 'wizard-spellbook-'),
  );

  // Safe ids only: a menu id is a path segment below.
  const menu = await fetchSkillMenu(getSkillsBaseUrl(), {
    timeoutMs: 10_000,
    maxAttempts: 1,
  });
  const entries = Object.values(menu?.categories ?? {})
    .flat()
    .filter((e) => /^[a-z0-9][a-z0-9_-]*$/.test(e.id));
  const skillId = session.skillId ?? program.skillId ?? 'integration';
  const selected = selectSkill(entries, skillId, session.integration);

  let skillsIncluded = false;
  if (selected) {
    const result = await downloadSkill(selected, directory, {
      skillsRoot: 'skills',
      triage: undefined,
    });
    if (result.success) skillsIncluded = true;
    else
      await fs.rm(path.join(directory, 'skills', selected.id), {
        recursive: true,
        force: true,
      });
  }

  const docs = [
    ...new Set(
      [session.frameworkConfig?.metadata.docsUrl, POSTHOG_DOCS_URL].filter(
        (url): url is string => Boolean(url),
      ),
    ),
  ];
  const readme = path.join(directory, 'README.md');
  await fs.writeFile(
    readme,
    `# Wizard spell book

Complete this task in the project containing this spell book:

${program.description}

Detected framework: ${
      session.frameworkConfig?.metadata.name ??
      session.integration ??
      'Not detected'
    }

Inspect the project before making changes. Check what has already been done, complete the task, run relevant checks, and explain any remaining manual steps.

Use your own credentials. Ask the user for any keys the task requires and keep them out of source code.

## Setup instructions

${
  skillsIncluded && selected
    ? `- [${selected.id}](skills/${selected.id}/SKILL.md)`
    : 'The skills could not be downloaded. Use the documentation below.'
}

## Official documentation

${docs.map((url) => `- ${url}`).join('\n')}
`,
  );
  return { path: readme, skillsIncluded };
}
