/**
 * `wizard skill list`: print every browsable skill in the catalog. It reads
 * the live `skill-menu.json`, so new skills appear right after a context-mill
 * release; `internal` skills are left out.
 */

import { getSkillsBaseUrl } from '@shared/constants';
import { ErrorCodes, emitWizardError } from '@shared/errors';
import { fetchSkillMenu, type CliEntry } from '@shared/skill-menu';
import { analytics } from '@utils/analytics';
import { flushAnalytics } from '@utils/flush-analytics';

const BROWSABLE_ROLES: ReadonlySet<CliEntry['role']> = new Set([
  'command',
  'skill',
]);

function formatEntry(entry: CliEntry): string {
  const path = entry.parentCommand
    ? `wizard ${entry.parentCommand} ${entry.command}`
    : entry.command
    ? `wizard ${entry.command}`
    : `wizard skill ${entry.skillId}`;
  return `  ${entry.skillId.padEnd(38)}  ${path.padEnd(36)}  ${
    entry.description
  }`;
}

/** Resolves 0 once the list is printed, or 1 when the registry is unreachable. */
export async function listSkills(): Promise<number> {
  const skillsBaseUrl = getSkillsBaseUrl();
  const menu = await fetchSkillMenu(skillsBaseUrl);
  if (!menu) {
    analytics.wizardCapture('cli dispatch error', {
      reason: 'registry unreachable',
      family: 'skill',
      sub: 'list',
      skillsBaseUrl,
    });
    await flushAnalytics();
    process.stderr.write(
      `\n\x1b[1;91m✖ Couldn't reach the skill registry.\x1b[0m\n` +
        `  Check your network connection and try again.\n\n`,
    );
    emitWizardError({
      code: ErrorCodes.SkillMenuFetchFailed,
      message: "Couldn't reach the skill registry.",
    });
    return 1;
  }
  const entries = (menu.cliEntries ?? []).filter((e) =>
    BROWSABLE_ROLES.has(e.role),
  );
  if (entries.length === 0) {
    process.stdout.write('No skills found.\n');
    return 0;
  }
  process.stdout.write(
    `${entries.length} skill${entries.length === 1 ? '' : 's'}:\n`,
  );
  process.stdout.write(
    `  ${'SKILL ID'.padEnd(38)}  ${'COMMAND'.padEnd(36)}  DESCRIPTION\n`,
  );
  for (const entry of entries) {
    process.stdout.write(`${formatEntry(entry)}\n`);
  }
  return 0;
}
