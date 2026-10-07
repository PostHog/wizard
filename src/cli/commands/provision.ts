import type { Arguments } from 'yargs';
import { consoleLog } from '@shared/console-log';
import { runProvision } from '@tools';
import { exitWith } from '@cli/runners';
import type { Command } from './command';

export const provisionCommand: Command = {
  name: 'provision',
  description: 'Create a new PostHog account (headless, no TUI)',
  options: {
    email: {
      describe: 'Email address for the new account',
      type: 'string',
      demandOption: true,
    },
    region: {
      describe: 'Cloud region (us or eu)',
      choices: ['us', 'eu'] as const,
      default: 'us',
    },
    name: {
      describe: 'Name for the new account',
      type: 'string',
      default: '',
    },
    json: {
      describe:
        'Emit JSON result to stdout (defaults to true when stdout is not a TTY)',
      type: 'boolean',
    },
  },
  examples: [
    ['wizard provision --email matt+test@posthog.com --region us', ''],
    ['wizard provision --email user@example.com --region eu --json', ''],
  ],
  handler: provision,
};

function provision(argv: Arguments): void {
  const jsonMode =
    argv.json === undefined ? !process.stdout.isTTY : Boolean(argv.json);
  exitWith(() =>
    runProvision(
      {
        email: argv.email as string,
        region: (argv.region as string).toUpperCase() as 'US' | 'EU',
        name: (argv.name as string) ?? '',
        baseUrl: argv.baseUrl as string | undefined,
        jsonMode,
      },
      { log: consoleLog },
    ),
  );
}
