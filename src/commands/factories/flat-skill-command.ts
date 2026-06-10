import {
  CLI_MANIFEST,
  type CliManifestEntry,
} from '@lib/programs/cli-manifest.generated';
import type { ProgramConfig } from '@lib/programs/program-step';

import type { Command } from '../command';
import { skillCommandFactory } from './skill-command-factory';

/**
 * Build a flat (top-level, no parent) skill command from the manifest entry
 * identified by `skillId`, with a graceful fallback when the manifest snapshot
 * doesn't carry it.
 *
 * Why this exists:
 *
 *   1. Robustness. `migrate.ts` / `revenue.ts` used to `throw` at module load
 *      if their entry was missing. Because those modules are imported at
 *      startup (via bin.ts), that throw took down the ENTIRE CLI — even
 *      `wizard --help` — whenever a build landed on the empty-manifest
 *      fallback. Here we degrade instead: synthesize the command from the
 *      local `ProgramConfig` (which already carries the command name,
 *      description, and skill id) and warn. `wizard migrate` keeps working,
 *      minus catalog polish, rather than bricking the binary.
 *
 *   2. Consistency. Both flat skill commands resolve their entry the same way
 *      — keyed on the stable `skillId`, not the user-facing command word
 *      (which is exactly what a CLI overhaul renames).
 */
export function flatSkillCommand(
  skillId: string,
  config: ProgramConfig,
): Command {
  const entry = CLI_MANIFEST.entries.find(
    (e) => e.role === 'command' && !e.parentCommand && e.skillId === skillId,
  );
  if (entry) {
    return skillCommandFactory(entry, config);
  }

  process.stderr.write(
    `[wizard] skill "${skillId}" is missing from the CLI manifest snapshot — ` +
      `falling back to the built-in command definition. Rebuild with network ` +
      `access to refresh the manifest.\n`,
  );

  const fallback: CliManifestEntry = {
    skillId,
    role: 'command',
    command: config.command ?? skillId,
    displayName: config.command ?? skillId,
    description: config.description,
  };
  return skillCommandFactory(fallback, config);
}
