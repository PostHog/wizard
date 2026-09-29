import { consoleLog } from '@shared/console-log';
import { CLI_STEERING_TARGETS } from '@shared/install-cli-steering';
import { runCliAdd } from '@tools';
import { exitWith } from '@cli/runners';
import type { Command } from '../command';

export const cliAddCommand: Command = {
  name: 'add',
  description:
    "Install or update PostHog CLI and add steering instructions to your coding agent's global instructions file",
  options: {
    agent: {
      describe: 'Agent to install the instructions for',
      choices: CLI_STEERING_TARGETS.map((target) => target.id),
      type: 'string',
    },
    path: {
      describe:
        'Write to an explicit instructions file instead of a detected agent',
      type: 'string',
    },
    all: {
      default: false,
      describe: 'Install for every detected agent without prompting',
      type: 'boolean',
    },
  },
  examples: [
    ['wizard cli add', 'Detect your coding agents and pick one'],
    [
      'wizard cli add --agent claude-code',
      'Install for Claude Code (~/.claude/CLAUDE.md)',
    ],
    ['wizard cli add --all', 'Install for every detected agent'],
    [
      'wizard cli add --path ./AGENTS.md',
      'Install into a specific instructions file',
    ],
  ],
  check: (argv) => {
    if (argv.all && (argv.agent || argv.path)) {
      throw new Error('--all cannot be combined with --agent or --path');
    }
    return true;
  },
  handler: (argv) => {
    exitWith(() =>
      runCliAdd(
        {
          agent: typeof argv.agent === 'string' ? argv.agent : undefined,
          path: typeof argv.path === 'string' ? argv.path : undefined,
          all: argv.all === true,
        },
        { log: consoleLog },
      ),
    );
  },
};
