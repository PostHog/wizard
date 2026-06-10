import { agentSkillConfig } from '@lib/programs/program-registry';
import {
  CLI_MANIFEST,
  type CliManifestEntry,
} from '@lib/programs/cli-manifest.generated';

import { dispatchProgram, mergeCommandOptions } from './factories/shared';
import type { Command } from './command';

/**
 * `wizard skill`        — list the runnable skills in the catalog.
 * `wizard skill <name>` — run that one skill.
 *
 * Two forms, nothing else: bare lists, named runs. The listing is the menu;
 * the name picks from it. Anything you see listed, you can run by name.
 *
 * Running dispatches the generic `agent-skill` program with the chosen skill
 * id, so any catalogued skill is runnable without being promoted to a
 * top-level command of its own.
 *
 * Catalog source is the build-time `CLI_MANIFEST` snapshot. `internal` skills
 * are kept out of both the listing and the runnable set (reachable only via
 * the hidden `--skill=<id>` dev escape hatch), mirroring how internal flags
 * stay out of `--help`.
 */
const BROWSABLE_ROLES = new Set(['command', 'skill']);

function browsableEntries(): CliManifestEntry[] {
  return CLI_MANIFEST.entries.filter((e) => BROWSABLE_ROLES.has(e.role));
}

function formatEntry(entry: CliManifestEntry): string {
  const path = entry.parentCommand
    ? `wizard ${entry.parentCommand} ${entry.command}`
    : entry.command
    ? `wizard ${entry.command}`
    : `wizard skill ${entry.skillId}`;
  return `  ${entry.skillId.padEnd(38)}  ${path.padEnd(36)}  ${
    entry.description
  }`;
}

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
    const query = String(argv.query ?? '').toLowerCase();
    if (!query) {
      process.stdout.write('No query provided.\n');
      return;
    }
    const matches = browsableEntries().filter(
      (entry) =>
        entry.skillId.toLowerCase().includes(query) ||
        entry.displayName.toLowerCase().includes(query) ||
        entry.description.toLowerCase().includes(query) ||
        (entry.command?.toLowerCase().includes(query) ?? false) ||
        (entry.parentCommand?.toLowerCase().includes(query) ?? false),
    );
    printEntries(matches);
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
    // The name the user types is the skill's name straight from the listing
    // (its context-mill skill id, e.g. `audit-events`). There's no separate
    // "id" — name and id are the same readable string here.
    const name = (argv.name as string | undefined)?.trim();

    // Bare `wizard skill` — list the runnable catalog so the user sees what
    // they can run, then exit. No TUI, no agent run.
    if (!name) {
      printEntries(browsableEntries());
      return;
    }

    // `wizard skill <name>` — run that skill, but only if the catalog knows
    // it. `skill` is a user-facing surface, so we refuse unknown (or internal)
    // names rather than handing an arbitrary string to the agent runner. You
    // can run anything the bare listing shows; nothing else.
    const runnable = browsableEntries().some((entry) => entry.skillId === name);
    if (!runnable) {
      process.stderr.write(
        `\x1b[1;91m✖ Unknown skill "${name}".\x1b[0m Run \`wizard skill\` to see what you can run.\n`,
      );
      process.exit(1);
    }

    dispatchProgram({ ...agentSkillConfig, skillId: name }, argv);
  },
};
