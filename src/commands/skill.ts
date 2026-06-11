import type { Arguments } from 'yargs';

import { agentSkillConfig } from '@lib/programs/program-registry';
import { getSkillsBaseUrl } from '@lib/constants';
import { fetchSkillMenu, type CliEntry } from '@lib/wizard-tools';

import { dispatchProgram, mergeCommandOptions } from './factories/shared';
import type { Command } from './command';

/**
 * `wizard skill`        — list the runnable skills in the catalog.
 * `wizard skill <name>` — run that one skill.
 *
 * The catalog is fetched live from `skill-menu.json` each invocation —
 * no baked snapshot. `internal` skills are excluded from both the listing
 * and the runnable set; they're reachable only via the hidden
 * `--skill=<id>` dev escape hatch.
 */
const BROWSABLE_ROLES: ReadonlySet<CliEntry['role']> = new Set([
  'command',
  'skill',
]);

async function fetchBrowsableEntries(
  argv: Arguments,
): Promise<CliEntry[] | null> {
  const skillsBaseUrl = getSkillsBaseUrl(Boolean(argv['local-mcp']));
  const menu = await fetchSkillMenu(skillsBaseUrl);
  if (!menu) return null;
  return (menu.cliEntries ?? []).filter((e) => BROWSABLE_ROLES.has(e.role));
}

function failFetch(): never {
  process.stderr.write(
    `\n\x1b[1;91m✖ Couldn't reach the skill registry.\x1b[0m\n` +
      `  Check your network connection and try again.\n\n`,
  );
  process.exit(1);
}

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

function printEntries(entries: readonly CliEntry[]): void {
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
}

const searchCommand: Command = {
  name: 'search <query>',
  description: 'Search the skill catalog by name or description',
  positionals: {
    query: {
      type: 'string',
      describe: 'Text to match against skill name or description',
    },
  },
  handler: (argv) => {
    void (async () => {
      const query = String(argv.query ?? '').toLowerCase();
      if (!query) {
        process.stdout.write('No query provided.\n');
        return;
      }
      const entries = await fetchBrowsableEntries(argv);
      if (!entries) failFetch();
      const matches = entries.filter(
        (entry) =>
          entry.skillId.toLowerCase().includes(query) ||
          entry.displayName.toLowerCase().includes(query) ||
          entry.description.toLowerCase().includes(query) ||
          (entry.command?.toLowerCase().includes(query) ?? false) ||
          (entry.parentCommand?.toLowerCase().includes(query) ?? false),
      );
      printEntries(matches);
    })();
  },
};

export const skillCommand: Command = {
  name: 'skill [name]',
  description: 'List skills, or run one by name',
  children: [searchCommand],
  options: mergeCommandOptions(agentSkillConfig),
  positionals: {
    name: {
      type: 'string',
      describe: 'Skill to run (omit to list every runnable skill)',
    },
  },
  handler: (argv) => {
    void (async () => {
      const name = (argv.name as string | undefined)?.trim();
      const entries = await fetchBrowsableEntries(argv);
      if (!entries) failFetch();

      if (!name) {
        printEntries(entries);
        return;
      }

      const runnable = entries.some((entry) => entry.skillId === name);
      if (!runnable) {
        process.stderr.write(
          `\x1b[1;91m✖ Unknown skill "${name}".\x1b[0m Run \`wizard skill\` to see what you can run.\n`,
        );
        process.exit(1);
      }

      dispatchProgram({ ...agentSkillConfig, skillId: name }, argv);
    })();
  },
};
