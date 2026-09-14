import type { Arguments } from 'yargs';
import { getUI, setUI } from '@ui';
import { LoggingUI } from '@ui/logging-ui';
import { API_KEY_HINT, runWizardCI, runWizardHeadless } from '@lib/runners';
import type { NonInteractiveMode } from '@lib/runners';
import { provisionNewAccount } from '@utils/provisioning';
import { posthogIntegrationConfig } from '@lib/programs/posthog-integration/index';
import { ErrorCodes, type ErrorCode } from '@lib/errors';
import { emitWizardError } from '@lib/errors';

type Options = Arguments & {
  region?: string;
  baseUrl?: string;
  installDir?: string;
  apiKey?: string;
  signup?: boolean;
  email?: string;
  name?: string;
  projectId?: string;
};

/**
 * CI-mode install entry point (`--ci`, dev/test builds). Thin shell over the
 * shared non-interactive install — see `runNonInteractiveInstall`.
 */
export function runCIInstall(argv: Arguments): void {
  runNonInteractiveInstall(argv, 'ci');
}

/**
 * Headless install entry point (the experimental published-build run path; see
 * @lib/headless-mode). Thin shell over the shared non-interactive install.
 * Today it behaves exactly like `runCIInstall`; it is a separate function so
 * headless can diverge later (auth, prompts, …) without touching the CI path.
 */
export function runHeadlessInstall(argv: Arguments): void {
  runNonInteractiveInstall(argv, 'headless');
}

/**
 * Non-interactive install shared by CI and headless. Validates signup flags,
 * optionally provisions an account, then installs. `mode` only changes
 * user-facing labels and which runner is invoked; the accepted keys and the
 * install itself are identical (see runNonInteractive).
 */
function runNonInteractiveInstall(
  argv: Arguments,
  mode: NonInteractiveMode,
): void {
  const options = { ...argv } as Options;
  const headless = mode === 'headless';
  const label = headless ? 'Headless' : 'CI';
  const runWizard = headless ? runWizardHeadless : runWizardCI;

  // Base validation (region/install-dir/api-key) is owned by the runner.
  // This layer only adds the signup branch on top.
  if (!options.apiKey && !options.signup) {
    return failCI(
      `${label} mode requires --api-key (${API_KEY_HINT}). ` +
        'To create a new account instead, use --signup --email you@example.com.',
      ErrorCodes.ArgsMissingApiKey,
    );
  }
  if (!options.apiKey && options.signup && !options.email) {
    return failCI(
      `${label} --signup requires --email to create a new account.`,
      ErrorCodes.ArgsMissingEmail,
    );
  }
  warnOnUnexpectedKeyPrefix(options.apiKey);

  void (async () => {
    if (!options.apiKey && options.signup) {
      // Fail before the irreversible provisioning step rather than after it.
      if (!options.installDir) {
        return failCI(
          `${label} mode requires --install-dir (directory to install in)`,
          ErrorCodes.ArgsMissingInstallDir,
        );
      }
      const provisioned = await provisionForSignup(options);
      options.apiKey = provisioned.personalApiKey;
      if (options.projectId == null) options.projectId = provisioned.projectId;
    }
    runWizard(posthogIntegrationConfig, options);
  })().catch((error: unknown) => {
    emitWizardError({
      code: ErrorCodes.ArgsSignupProvisionFailed,
      message: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}

function failCI(message: string, code?: ErrorCode): void {
  setUI(new LoggingUI());
  getUI().intro('PostHog Wizard');
  getUI().log.error(message);
  if (code) emitWizardError({ code, message });
  process.exit(1);
}

/**
 * Decide whether to warn about an unexpected `--api-key` prefix, and with what
 * message. Returns `null` when the key is acceptable.
 *
 * CI and headless accept the same two credentials: a personal API key (`phx_`)
 * and a `pha_` OAuth access token minted under the wizard's own OAuth
 * application (cloud runs, and the CI bot). Both authenticate the mint the
 * same way. Anything else is unexpected and warns.
 *
 * Extracted as a pure predicate so it can be unit-tested without a UI.
 */
export function keyPrefixWarning(apiKey: string | undefined): string | null {
  if (!apiKey || apiKey.startsWith('phx_') || apiKey.startsWith('pha_')) {
    return null;
  }
  const hint = apiKey.startsWith('phc_')
    ? ' (phc_ is a project/client key; expected a personal API key or a wizard-app token)'
    : '';
  return `--api-key does not start with "phx_" or "pha_"${hint}. Continuing anyway, but the LLM Gateway may reject it with a 401.`;
}

function warnOnUnexpectedKeyPrefix(apiKey: string | undefined): void {
  const message = keyPrefixWarning(apiKey);
  if (!message) return;
  setUI(new LoggingUI());
  getUI().intro('PostHog Wizard');
  getUI().log.warn(message);
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
      { baseUrl: options.baseUrl },
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
