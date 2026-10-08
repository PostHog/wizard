import type { ConsoleLog } from '@shared/console-log';
import type { ProvisioningResult } from '@utils/provisioning';

export type ProvisionArgs = {
  email: string;
  region: 'US' | 'EU';
  name: string;
  baseUrl?: string;
  jsonMode: boolean;
};

/** Resolves 0 once the account exists, else 1. */
export async function runProvision(
  { email, region, name, baseUrl, jsonMode }: ProvisionArgs,
  { log }: { log: ConsoleLog },
): Promise<number> {
  try {
    const { provisionNewAccount } = await import('@utils/provisioning');
    if (!jsonMode) {
      log.log.info(`Provisioning account for ${email} in ${region}...`);
    }
    const result = await provisionNewAccount(email, name, region, { baseUrl });
    emitResult(result, jsonMode, log);
    return 0;
  } catch (error) {
    emitError(error, jsonMode, log);
    return 1;
  }
}

function emitResult(
  result: ProvisioningResult,
  jsonMode: boolean,
  log: ConsoleLog,
): void {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  log.log.success('Account provisioned successfully:');
  log.log.info(`  API Key:       ${result.projectApiKey}`);
  log.log.info(`  Host:          ${result.host}`);
  log.log.info(`  Project ID:    ${result.projectId}`);
  log.log.info(`  Account ID:    ${result.accountId}`);
  log.log.info(`  Access Token:  ${result.accessToken}`);
  log.log.info(`  Refresh Token: ${result.refreshToken}`);
  if (result.personalApiKey) {
    log.log.info(`  Personal API Key: ${result.personalApiKey}`);
  }
}

function emitError(error: unknown, jsonMode: boolean, log: ConsoleLog): void {
  const msg = error instanceof Error ? error.message : String(error);
  const code = msg.includes('already associated')
    ? 'email_exists'
    : 'provisioning_failed';
  if (jsonMode) {
    process.stderr.write(`${JSON.stringify({ error: msg, code })}\n`);
    return;
  }
  log.log.error(`Provisioning failed: ${msg}`);
}
