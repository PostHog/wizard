import type { Arguments } from 'yargs';
import { getUI, setUI } from '@ui';
import { LoggingUI } from '@ui/logging-ui';
import { runWizardCI } from '@lib/runners';

type Options = Arguments & {
  region?: string;
  installDir?: string;
  apiKey?: string;
  signup?: boolean;
  email?: string;
  name?: string;
  projectId?: string;
};

/** CI-mode entry point: validate flags, optionally provision an account, then install. */
export function runCIInstall(argv: Arguments): void {
  const options = { ...argv } as Options;
  if (!options.region) options.region = 'us';

  if (!options.installDir) {
    return failCI('CI mode requires --install-dir (directory to install in)');
  }
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
      const provisioned = await provisionForSignup(options);
      if (!provisioned) return;
      options.apiKey = provisioned.personalApiKey;
      if (options.projectId == null) options.projectId = provisioned.projectId;
    }
    await runInstall(options);
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

async function provisionForSignup(options: Options): Promise<
  | {
      personalApiKey: string;
      projectId: string;
    }
  | undefined
> {
  setUI(new LoggingUI());
  getUI().intro('PostHog Wizard');
  try {
    const { provisionNewAccount } = await import('@utils/provisioning');
    const signupRegion = (options.region as string).toUpperCase() as
      | 'US'
      | 'EU';
    getUI().log.info(
      `Provisioning new PostHog account for ${String(
        options.email,
      )} in ${signupRegion}...`,
    );
    const result = await provisionNewAccount(
      options.email as string,
      options.name ?? '',
      signupRegion,
    );
    if (!result.personalApiKey) {
      getUI().log.error(
        'Provisioning succeeded but no personal API key was returned — cannot continue install.',
      );
      process.exit(1);
      return undefined;
    }
    getUI().log.success('Account ready.');
    getUI().log.info(`  Project API Key:  ${result.projectApiKey}`);
    getUI().log.info(`  Personal API Key: ${result.personalApiKey}`);
    getUI().log.info(`  Host:             ${result.host}`);
    return {
      personalApiKey: result.personalApiKey,
      projectId: result.projectId,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    getUI().log.error(`Provisioning failed: ${msg}`);
    process.exit(1);
    return undefined;
  }
}

async function runInstall(options: Options): Promise<void> {
  const { posthogIntegrationConfig } = await import(
    '@lib/programs/posthog-integration/index'
  );
  const { FRAMEWORK_REGISTRY } = await import('@lib/registry');
  const { detectFramework, gatherFrameworkContext } = await import(
    '@lib/detection/index'
  );
  const { analytics } = await import('@utils/analytics');
  const { wizardAbort } = await import('@utils/wizard-abort');

  // preRun: honor --integration, else auto-detect, then gather framework
  // context. Bypasses onReady hooks by design.
  runWizardCI(posthogIntegrationConfig, options, async (session) => {
    const integration =
      session.integration ?? (await detectFramework(session.installDir));
    if (!integration) {
      await wizardAbort({
        message:
          'Could not auto-detect your framework. Please specify --integration on the command line.',
      });
      return;
    }
    session.integration = integration;
    analytics.setTag('integration', integration);

    const frameworkConfig = FRAMEWORK_REGISTRY[integration];
    session.frameworkConfig = frameworkConfig;

    const context = await gatherFrameworkContext(frameworkConfig, {
      installDir: session.installDir,
      debug: session.debug,
      forceInstall: session.forceInstall,
      default: false,
      signup: session.signup,
      localMcp: session.localMcp,
      ci: true,
      menu: session.menu,
      benchmark: session.benchmark,
      yaraReport: session.yaraReport,
    });
    for (const [key, value] of Object.entries(context)) {
      if (!(key in session.frameworkContext)) {
        session.frameworkContext[key] = value;
      }
    }
  });
}
