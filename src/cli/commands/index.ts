import { PROGRAM_REGISTRY, type ProgramConfig } from '@programs';
import type { ProgramId } from '@programs/types';

import { commandKeys, type Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';
import { basicIntegrationCommand } from './basic-integration';
import { mcpCommand } from './mcp';
import { cliCommand } from './cli';
import { auditCommand } from './audit';
import { doctorCommand } from './doctor';
import { selfDrivingCommand } from './self-driving';
import { slackCommand } from './slack';
import { skillCommand } from './skill';

/**
 * The commands whose shape is their own, not a program config's: the default
 * flow, families, and the tools'. Each is listed at the place in
 * `PROGRAM_REGISTRY` of the program named in `at`, before that program's
 * generated command. A custom command that takes a program's `command` word
 * replaces the generated one.
 */
const CUSTOM_COMMANDS: ReadonlyArray<{ at: ProgramId; command: Command }> = [
  { at: 'posthog-integration', command: basicIntegrationCommand },
  // The tools front no program; `wizard --help` has always listed them here.
  { at: 'mcp-analytics', command: mcpCommand },
  { at: 'audit', command: cliCommand },
  { at: 'audit', command: auditCommand },
  { at: 'migration', command: doctorCommand },
  { at: 'self-driving', command: selfDrivingCommand },
  { at: 'error-tracking-upload-source-maps', command: slackCommand },
  { at: 'agent-skill', command: skillCommand },
];

/**
 * Every top-level `wizard` command, in `wizard --help` order: the registry's.
 * A program with a top-level `command` and no custom command gets one built
 * from its config, so adding one needs no change here.
 */
export function wizardCommands(
  programs: readonly ProgramConfig[] = PROGRAM_REGISTRY,
): Command[] {
  const customWords = new Set(
    CUSTOM_COMMANDS.flatMap(({ command }) => commandKeys(command.name)),
  );
  return programs.flatMap((config) => [
    ...CUSTOM_COMMANDS.filter(({ at }) => at === config.id).map(
      ({ command }) => command,
    ),
    ...(config.command &&
    !config.parentCommand &&
    !customWords.has(config.command)
      ? [nativeCommandFactory(config)]
      : []),
  ]);
}
