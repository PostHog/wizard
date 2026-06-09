import { agentSkillConfig } from '@lib/programs/program-registry';
import {
  CLI_MANIFEST,
  type CliManifestEntry,
} from '@lib/programs/cli-manifest.generated';

import { dispatchProgram, mergeCommandOptions } from './factories/shared';
import type { Command } from './command';

/**
 * Catalog-access subcommands: `wizard skill list`, `wizard skill search`,
 * and `wizard skill <id>`.
 *
 * `list` and `search` are read-only catalog inspection — they print to
 * stdout and exit without spinning up the TUI. The bare `wizard skill <id>`
 * form dispatches to the generic `agent-skill` program with the supplied
 * skill id, so any skill in the catalog is runnable even when it's not
 * promoted as a top-level public command.
 *
 * The catalog source today is `CLI_MANIFEST.entries` (the build-time
 * snapshot). The browsable listings (`list`, `search`, and bare `skill`)
 * show `command` + `skill` entries; `internal` skills are hidden unless
 * `--role internal` is passed, but stay runnable by id.
 */
function formatEntry(entry: CliManifestEntry): string {
  const path = entry.parentCommand
    ? `wizard ${entry.parentCommand} ${entry.command}`
    : `wizard ${entry.command}`;
  return `  ${entry.skillId.padEnd(38)}  ${path.padEnd(36)}  ${
    entry.description
  }`;
}

/**
 * Roles shown in the browsable catalog by default. `internal` skills are
 * hidden unless explicitly requested via `--role internal`, mirroring how
 * internal flags are kept out of `--help`. They remain runnable by id for
 * anyone who knows it (`wizard skill <id>` / the `--skill` escape hatch).
 */
const BROWSABLE_ROLES = new Set(['command', 'skill']);

function printEntries(entries: readonly CliManifestEntry[]): void {
  if (entries.length === 0) {
    process.stdout.write(
      'No skills found. The CLI manifest may not have been fetched yet — run a build with network access.\n',
    );
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

const listCommand: Command = {
  name: 'list',
  description: 'List skills in the wizard catalog',
  options: {
    role: {
      describe: 'Filter by role',
      type: 'string',
      choices: ['command', 'skill', 'internal'] as const,
    },
  },
  handler: (argv) => {
    const role = (argv.role as string | undefined) ?? undefined;
    const entries = CLI_MANIFEST.entries.filter((e) =>
      role == null ? BROWSABLE_ROLES.has(e.role) : e.role === role,
    );
    printEntries(entries);
  },
};

const searchCommand: Command = {
  name: 'search <query>',
  description: 'Search the wizard skill catalog by name or description',
  handler: (argv) => {
    const query = String(argv.query ?? '').toLowerCase();
    if (!query) {
      process.stdout.write('No query provided.\n');
      return;
    }
    const matches = CLI_MANIFEST.entries.filter((entry) => {
      if (!BROWSABLE_ROLES.has(entry.role)) return false;
      return (
        entry.skillId.toLowerCase().includes(query) ||
        entry.displayName.toLowerCase().includes(query) ||
        entry.description.toLowerCase().includes(query) ||
        (entry.command?.toLowerCase().includes(query) ?? false) ||
        (entry.parentCommand?.toLowerCase().includes(query) ?? false)
      );
    });
    printEntries(matches);
  },
};

export const skillCommand: Command = {
  name: 'skill [id]',
  description: 'Explore and run skills from the wizard catalog',
  children: [listCommand, searchCommand],
  options: mergeCommandOptions(agentSkillConfig),
  handler: (argv) => {
    const id = (argv.id as string | undefined)?.trim();
    if (!id) {
      // Bare `wizard skill` with no positional — list the catalog so the
      // user sees what's available. Cheaper than yargs's help dump and the
      // ids are what they need to invoke a specific skill. Internal skills
      // stay hidden here (see BROWSABLE_ROLES).
      printEntries(
        CLI_MANIFEST.entries.filter((e) => BROWSABLE_ROLES.has(e.role)),
      );
      return;
    }
    const config = { ...agentSkillConfig, skillId: id };
    dispatchProgram(config, argv);
  },
};
