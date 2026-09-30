import { getSkillsBaseUrl } from '@shared/constants';
import { fetchSkillMenu, type CliEntry } from '@shared/skill-menu';
import { analytics } from '@utils/analytics';
import { runCommandHandler } from '@cli/commands/factories/shared';
import { ErrorCodes, emitWizardError } from '@shared/errors';
import type { Command } from '@cli/commands/command';

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

/**
 * `wizard skill list` — fetch and print every browsable skill in the catalog.
 *
 * Reads the live `skill-menu.json` so new skills appear immediately after a
 * context-mill release. `internal` skills are excluded from the listing.
 */
export const listCommand: Command = {
  name: 'list',
  description: 'List every browsable skill in the catalog',
  handler: () => {
    runCommandHandler(async () => {
      const skillsBaseUrl = getSkillsBaseUrl();
      const menu = await fetchSkillMenu(skillsBaseUrl);
      if (!menu) {
        analytics.wizardCapture('cli dispatch error', {
          reason: 'registry unreachable',
          family: 'skill',
          sub: 'list',
          skillsBaseUrl,
        });
        try {
          await analytics.flush();
        } catch {
          /* best-effort */
        }
        process.stderr.write(
          `\n\x1b[1;91m✖ Couldn't reach the skill registry.\x1b[0m\n` +
            `  Check your network connection and try again.\n\n`,
        );
        emitWizardError({
          code: ErrorCodes.SkillMenuFetchFailed,
          message: "Couldn't reach the skill registry.",
        });
        process.exit(1);
      }
      const entries = (menu.cliEntries ?? []).filter((e) =>
        BROWSABLE_ROLES.has(e.role),
      );
      if (entries.length === 0) {
        process.stdout.write('No skills found.\n');
        return;
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
    });
  },
};
