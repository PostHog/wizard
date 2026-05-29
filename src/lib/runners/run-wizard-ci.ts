import { POSTHOG_DOCS_URL } from '@lib/constants';
import { getUI, setUI } from '@ui';
import { LoggingUI } from '@ui/logging-ui';
import type { ProgramConfig } from '@lib/programs/program-step';

/**
 * The single CI validation layer: defaults region and requires api-key and
 * install-dir. Every CI entry point routes through `runWizardCI`, so this is
 * the one place these checks live. UI must be initialized before calling.
 */
export function validateCiOptions(options: Record<string, unknown>): void {
  if (!options.region) options.region = 'us';
  if (!options.apiKey) {
    getUI().intro('PostHog Wizard');
    getUI().log.error('CI mode requires --api-key (personal API key phx_xxx)');
    process.exit(1);
  }
  if (!options.installDir) {
    getUI().intro('PostHog Wizard');
    getUI().log.error(
      'CI mode requires --install-dir (directory to install in)',
    );
    process.exit(1);
  }
}

/**
 * CI-mode pipeline shared by every non-interactive entry point.
 *
 * Validates flags, builds a `ci:true` session, runs `config.ciPreRun` (or the
 * program's `onReady` hooks by default), executes `runAgent`, and routes any
 * failure through `wizardAbort`. `wizardAbort` owns all exits — never add a
 * raw `process.exit` here.
 */
export function runWizardCI(
  config: ProgramConfig,
  options: Record<string, unknown>,
): void {
  setUI(new LoggingUI());
  validateCiOptions(options);

  void (async () => {
    const path = await import('path');
    const { buildSession } = await import('@lib/wizard-session');
    const { readEnvironment } = await import('@utils/environment');
    const { readApiKeyFromEnv } = await import('@utils/env-api-key');
    const { configureLogFileFromEnvironment, logToFile } = await import(
      '@utils/debug'
    );
    const { wizardAbort, WizardError } = await import('@utils/wizard-abort');

    configureLogFileFromEnvironment();

    const env = readEnvironment();
    const apiKey =
      (options.apiKey as string) ?? readApiKeyFromEnv() ?? undefined;
    const installDir = path.isAbsolute(options.installDir as string)
      ? (options.installDir as string)
      : path.join(process.cwd(), options.installDir as string);

    const session = buildSession({
      debug: options.debug as boolean | undefined,
      forceInstall: options.forceInstall as boolean | undefined,
      installDir,
      ci: true,
      signup: options.signup as boolean | undefined,
      localMcp: options.localMcp as boolean | undefined,
      apiKey,
      email: options.email as string | undefined,
      menu: options.menu as boolean | undefined,
      projectId: options.projectId as string | undefined,
      benchmark: options.benchmark as boolean | undefined,
      yaraReport: options.yaraReport as boolean | undefined,
      ...env,
    });
    session.programLabel = config.id;
    if (config.skillId) {
      session.skillId = config.skillId;
    }
    const runDef = typeof config.run === 'object' ? config.run : null;

    getUI().intro('Welcome to the PostHog setup wizard');
    getUI().log.info(`Running ${config.id} in CI mode`);

    try {
      if (config.ciPreRun) {
        await config.ciPreRun(session);
      } else {
        const readyCtx = {
          session,
          setFrameworkContext: (key: string, value: unknown) => {
            session.frameworkContext[key] = value;
          },
          setFrameworkConfig: () => undefined,
          setDetectedFramework: () => undefined,
          setUnsupportedVersion: () => undefined,
          addDiscoveredFeature: () => undefined,
          setDetectionComplete: () => undefined,
        };
        for (const step of config.steps) {
          if (step.onReady) {
            await step.onReady(readyCtx);
          }
        }

        const detectError = session.frameworkContext.detectError as
          | { kind: string; [k: string]: unknown }
          | undefined;
        if (detectError) {
          await wizardAbort({
            message: `Prerequisites not met: ${detectError.kind}\n\nSee ${
              runDef?.docsUrl ?? POSTHOG_DOCS_URL
            }`,
            error: new WizardError(`${config.id} prerequisites failed`, {
              integration: config.id,
              detect_error_kind: detectError.kind,
            }),
          });
        }
      }

      const { runAgent } = await import('@lib/agent/agent-runner');
      await runAgent(config, session);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack =
        error instanceof Error && error.stack ? error.stack : undefined;

      logToFile(`[bin.ts CI] ERROR: ${errorMessage}`);
      if (errorStack) logToFile(`[bin.ts CI] STACK: ${errorStack}`);

      const debugInfo = session.debug && errorStack ? `\n\n${errorStack}` : '';
      const docsUrl =
        session.frameworkConfig?.metadata.docsUrl ??
        runDef?.docsUrl ??
        POSTHOG_DOCS_URL;
      await wizardAbort({
        message: `Something went wrong: ${errorMessage}\n\nYou can read the documentation at ${docsUrl} to set up manually.${debugInfo}`,
        error: error as Error,
      });
    }
  })().catch(() => {
    process.exit(1);
  });
}
