import type { Arguments } from 'yargs';
import { getUI, setUI } from '@ui';
import { LoggingUI } from '@ui/logging-ui';
import { runWizardCI, runWizardHeadless } from '@lib/runners';
import type { NonInteractiveMode } from '@lib/runners';
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
 * user-facing labels, which api-key prefixes are accepted, and which runner is
 * invoked — the install itself is identical (see runNonInteractive).
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
    const keyHint = headless
      ? 'personal API key phx_xxx or pha_ OAuth access token'
      : 'personal API key phx_xxx';
    return failCI(
      `${label} mode requires --api-key (${keyHint}). ` +
        'To create a new account instead, use --signup --email you@example.com.',
    );
  }
  if (!options.apiKey && options.signup && !options.email) {
    return failCI(
      `${label} --signup requires --email to create a new account.`,
    );
  }
  warnOnUnexpectedKeyPrefix(options.apiKey, headless);

  void (async () => {
    if (!options.apiKey && options.signup) {
      // Fail before the irreversible provisioning step rather than after it.
      if (!options.installDir) {
        return failCI(
          `${label} mode requires --install-dir (directory to install in)`,
        );
      }
      const provisioned = await provisionForSignup(options);
      options.apiKey = provisioned.personalApiKey;
      if (options.projectId == null) options.projectId = provisioned.projectId;
    }
    runWizard(posthogIntegrationConfig, options);
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

/**
 * Decide whether to warn about an unexpected `--api-key` prefix, and with what
 * message. Returns `null` when the key is acceptable for the mode.
 *
 * This is the one behavioral fork between `--ci` and headless mode: the LLM
 * Gateway accepts a personal API key (`phx_`) in either mode, but in headless
 * a `pha_` OAuth access token is *also* first-class — PostHog mints one under
 * the wizard's own OAuth application for cloud runs and passes it as the
 * api-key. Outside headless that token is unexpected and still warns.
 *
 * Extracted as a pure predicate so the fork can be unit-tested without a UI.
 */
export function keyPrefixWarning(
  apiKey: string | undefined,
  headless: boolean,
): string | null {
  if (!apiKey || apiKey.startsWith('phx_')) return null;
  if (headless && apiKey.startsWith('pha_')) return null;
  const prefix = apiKey.slice(0, 4);
  const hint =
    prefix === 'pha_'
      ? ' (pha_ is an OAuth access token — CI mode expects a personal API key)'
      : prefix === 'phc_'
      ? ' (phc_ is a project/client key — expected a personal API key)'
      : '';
  return `--api-key does not start with "phx_"${hint}. Continuing anyway, but the LLM Gateway may reject it with a 401.`;
}

function warnOnUnexpectedKeyPrefix(
  apiKey: string | undefined,
  headless: boolean,
): void {
  const message = keyPrefixWarning(apiKey, headless);
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
