import type { Arguments } from 'yargs';
import { getUI, setUI } from '@ui';
import { LoggingUI } from '@ui/logging-ui';
import type { ProvisioningResult } from '@utils/provisioning';
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
  handler: runProvision,
};

function runProvision(argv: Arguments): void {
  const jsonMode =
    argv.json === undefined ? !process.stdout.isTTY : Boolean(argv.json);
  if (!jsonMode) setUI(new LoggingUI());

  void provision({
    email: argv.email as string,
    region: (argv.region as string).toUpperCase() as 'US' | 'EU',
    name: (argv.name as string) ?? '',
    jsonMode,
  });
}

type ProvisionArgs = {
  email: string;
  region: 'US' | 'EU';
  name: string;
  jsonMode: boolean;
};

async function provision({
  email,
  region,
  name,
  jsonMode,
}: ProvisionArgs): Promise<void> {
  try {
    const { provisionNewAccount } = await import('@utils/provisioning');
    if (!jsonMode) {
      getUI().log.info(`Provisioning account for ${email} in ${region}...`);
    }
    const result = await provisionNewAccount(email, name, region);
    emitResult(result, jsonMode);
    process.exit(0);
  } catch (error) {
    emitError(error, jsonMode);
    process.exit(1);
  }
}

function emitResult(result: ProvisioningResult, jsonMode: boolean): void {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  getUI().log.success('Account provisioned successfully:');
  getUI().log.info(`  API Key:       ${result.projectApiKey}`);
  getUI().log.info(`  Host:          ${result.host}`);
  getUI().log.info(`  Project ID:    ${result.projectId}`);
  getUI().log.info(`  Account ID:    ${result.accountId}`);
  getUI().log.info(`  Access Token:  ${result.accessToken}`);
  getUI().log.info(`  Refresh Token: ${result.refreshToken}`);
  if (result.personalApiKey) {
    getUI().log.info(`  Personal API Key: ${result.personalApiKey}`);
  }
}

function emitError(error: unknown, jsonMode: boolean): void {
  const msg = error instanceof Error ? error.message : String(error);
  const code = msg.includes('already associated')
    ? 'email_exists'
    : 'provisioning_failed';
  if (jsonMode) {
    process.stderr.write(`${JSON.stringify({ error: msg, code })}\n`);
    return;
  }
  getUI().log.error(`Provisioning failed: ${msg}`);
}
