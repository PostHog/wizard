import type { Arguments } from 'yargs';
import { getUI, setUI } from '@ui';
import { LoggingUI } from '@ui/logging-ui';
import { runWizardCI } from '@lib/runners';
import { provisionNewAccount } from '@utils/provisioning';
import { posthogIntegrationConfig } from '@lib/programs/posthog-integration/index';

type Options = Arguments & {
  region?: string;
  installDir?: string;
  apiKey?: string;
  signup?: boolean;
  email?: string;
  name?: string;
  projectId?: string;
};

/** CI-mode entry point: validate signup flags, optionally provision an account, then install. */
export function runCIInstall(argv: Arguments): void {
  const options = { ...argv } as Options;

  // Base CI validation (region/install-dir/api-key) is owned by runWizardCI.
  // runCIInstall only layers the signup branch on top.
  if (!options.apiKey && !options.signup) {
    return failCI(
      'CI mode requires --api-key (personal API key phx_xxx). ' +
        'To create a new account instead, use --signup --email you@example.com.',
    );
  }
  if (!options.apiKey && options.signup && !options.email) {
    return failCI('CI --signup requires --email to create a new account.');
  }
  warnOnUnexpectedKeyPrefix(options.apiKey);

  void (async () => {
    if (!options.apiKey && options.signup) {
      // Fail before the irreversible provisioning step rather than after it.
      if (!options.installDir) {
        return failCI(
          'CI mode requires --install-dir (directory to install in)',
        );
      }
      const provisioned = await provisionForSignup(options);
      options.apiKey = provisioned.personalApiKey;
      if (options.projectId == null) options.projectId = provisioned.projectId;
    }
    runWizardCI(posthogIntegrationConfig, options);
  })().catch(() => {
    process.exit(1);
  });
}

function failCI(message: string): void {
  setUI(new LoggingUI());
  getUI().intro('PostHog Wizard');
  getUI().log.error(message);
  process.exit(1);
}

/** `phx_` is the personal-API-key prefix the LLM Gateway expects. */
function warnOnUnexpectedKeyPrefix(apiKey: string | undefined): void {
  if (!apiKey || apiKey.startsWith('phx_')) return;
  setUI(new LoggingUI());
  getUI().intro('PostHog Wizard');
  const prefix = apiKey.slice(0, 4);
  const hint =
    prefix === 'pha_'
      ? ' (pha_ is an OAuth access token — CI mode expects a personal API key)'
      : prefix === 'phc_'
      ? ' (phc_ is a project/client key — CI mode expects a personal API key)'
      : '';
  getUI().log.warn(
    `--api-key does not start with "phx_"${hint}. Continuing anyway, but the LLM Gateway may reject it with a 401.`,
  );
}

/**
 * Provision a new account and return its credentials. Throws on any failure
 * (after logging a user-facing message); the caller's `.catch` turns that
 * into a non-zero exit. The return type carries no failure sentinel.
 */
async function provisionForSignup(
  options: Options,
): Promise<{ personalApiKey: string; projectId: string }> {
  setUI(new LoggingUI());
  getUI().intro('PostHog Wizard');
  const signupRegion = ((options.region as string) || 'us').toUpperCase() as
    | 'US'
    | 'EU';
  getUI().log.info(
    `Provisioning new PostHog account for ${String(
      options.email,
    )} in ${signupRegion}...`,
  );

  let result;
  try {
    result = await provisionNewAccount(
      options.email as string,
      options.name ?? '',
      signupRegion,
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    getUI().log.error(`Provisioning failed: ${msg}`);
    throw error;
  }

  if (!result.personalApiKey) {
    getUI().log.error(
      'Provisioning succeeded but no personal API key was returned — cannot continue install.',
    );
    throw new Error('provisioning returned no personal API key');
  }

  getUI().log.success('Account ready.');
  getUI().log.info(`  Project API Key:  ${result.projectApiKey}`);
  getUI().log.info(`  Personal API Key: ${result.personalApiKey}`);
  getUI().log.info(`  Host:             ${result.host}`);
  return {
    personalApiKey: result.personalApiKey,
    projectId: result.projectId,
  };
}
