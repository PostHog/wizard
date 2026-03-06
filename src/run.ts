import { type WizardSession, buildSession } from './lib/wizard-session';

import { Integration, DETECTION_TIMEOUT_MS } from './lib/constants';
import { readEnvironment } from './utils/environment';
import { getUI } from './ui';
import path from 'path';
import { FRAMEWORK_REGISTRY } from './lib/registry';
import { analytics } from './utils/analytics';
import { runAgentWizard } from './lib/agent-runner';
import { EventEmitter } from 'events';
import chalk from 'chalk';
import { logToFile } from './utils/debug';

EventEmitter.defaultMaxListeners = 50;

type Args = {
  integration?: Integration;
  debug?: boolean;
  forceInstall?: boolean;
  installDir?: string;
  default?: boolean;
  signup?: boolean;
  localMcp?: boolean;
  ci?: boolean;
  apiKey?: string;
  projectId?: string;
  menu?: boolean;
  benchmark?: boolean;
};

export async function runWizard(argv: Args, session?: WizardSession) {
  const finalArgs = {
    ...argv,
    ...readEnvironment(),
  };

  let resolvedInstallDir: string;
  if (finalArgs.installDir) {
    if (path.isAbsolute(finalArgs.installDir)) {
      resolvedInstallDir = finalArgs.installDir;
    } else {
      resolvedInstallDir = path.join(process.cwd(), finalArgs.installDir);
    }
  } else {
    resolvedInstallDir = process.cwd();
  }

  // Build session if not provided (CI mode passes one pre-built)
  if (!session) {
    session = buildSession({
      debug: finalArgs.debug,
      forceInstall: finalArgs.forceInstall,
      installDir: resolvedInstallDir,
      ci: finalArgs.ci,
      signup: finalArgs.signup,
      localMcp: finalArgs.localMcp,
      apiKey: finalArgs.apiKey,
      menu: finalArgs.menu,
      integration: finalArgs.integration,
      benchmark: finalArgs.benchmark,
      projectId: finalArgs.projectId,
    });
  }

  session.installDir = resolvedInstallDir;

  getUI().intro(`Welcome to the PostHog setup wizard`);

  if (session.ci) {
    getUI().log.info(chalk.dim('Running in CI mode'));
  }

  const integration =
    session.integration ?? (await detectAndResolveIntegration(session));

  session.integration = integration;
  analytics.setTag('integration', integration);

  const config = FRAMEWORK_REGISTRY[integration];
  session.frameworkConfig = config;

  // Run gatherContext if the framework has it and it hasn't already run
  // (bin.ts runs it early so IntroScreen can show the friendly label)
  const contextAlreadyGathered =
    Object.keys(session.frameworkContext).length > 0;
  if (config.metadata.gatherContext && !contextAlreadyGathered) {
    try {
      const context = await config.metadata.gatherContext({
        installDir: session.installDir,
        debug: session.debug,
        forceInstall: session.forceInstall,
        default: false,
        signup: session.signup,
        localMcp: session.localMcp,
        ci: session.ci,
        menu: session.menu,
        benchmark: session.benchmark,
      });
      for (const [key, value] of Object.entries(context)) {
        if (!(key in session.frameworkContext)) {
          session.frameworkContext[key] = value;
        }
      }
    } catch {
      // Detection failed — SetupScreen or agent will handle it
    }
  }

  try {
    await runAgentWizard(config, session);
  } catch (error) {
    analytics.captureException(error as Error, {
      integration,
      arguments: JSON.stringify(finalArgs),
    });

    await analytics.shutdown('error');

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack =
      error instanceof Error && error.stack ? error.stack : undefined;

    logToFile(`[Wizard run.ts] ERROR MESSAGE: ${errorMessage} `);
    if (errorStack) {
      logToFile(`[Wizard run.ts] ERROR STACK: ${errorStack}`);
    }

    getUI().log.error(
      `Something went wrong: ${chalk.red(
        errorMessage,
      )}\n\nYou can read the documentation at ${chalk.cyan(
        config.metadata.docsUrl,
      )} to set up PostHog manually.`,
    );

    if (session.debug && errorStack) {
      getUI().log.info(chalk.dim(errorStack));
    }

    process.exit(1);
  }
}

export async function detectIntegration(
  installDir: string,
): Promise<Integration | undefined> {
  for (const integration of Object.values(Integration)) {
    const config = FRAMEWORK_REGISTRY[integration];
    try {
      const detected = await Promise.race([
        config.detection.detect({ installDir }),
        new Promise<false>((resolve) =>
          setTimeout(() => resolve(false), DETECTION_TIMEOUT_MS),
        ),
      ]);
      if (detected) {
        return integration;
      }
    } catch {
      // Skip frameworks whose detection throws
    }
  }
}

async function detectAndResolveIntegration(
  session: WizardSession,
): Promise<Integration> {
  if (!session.menu) {
    const detectedIntegration = await detectIntegration(session.installDir);

    if (detectedIntegration) {
      getUI().setDetectedFramework(
        FRAMEWORK_REGISTRY[detectedIntegration].metadata.name,
      );
      return detectedIntegration;
    }

    getUI().log.info(
      "I couldn't detect your framework. Please choose one to get started.",
    );
  }

  // Fallback: in TUI mode the IntroScreen would handle this,
  // but for CI mode or when detection fails, abort with guidance.
  getUI().log.error(
    'Could not auto-detect your framework. Please specify --integration on the command line.',
  );
  process.exit(1);
}
