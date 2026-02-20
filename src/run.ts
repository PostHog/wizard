import { abortIfCancelled } from './utils/clack-utils';

import type { CloudRegion, WizardOptions } from './utils/types';

import { Integration } from './lib/constants';
import { readEnvironment } from './utils/environment';
import clack from './utils/clack';
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
  region?: CloudRegion;
  default?: boolean;
  signup?: boolean;
  localMcp?: boolean;
  ci?: boolean;
  apiKey?: string;
  menu?: boolean;
};

export async function runWizard(argv: Args) {
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

  const wizardOptions: WizardOptions = {
    debug: finalArgs.debug ?? false,
    forceInstall: finalArgs.forceInstall ?? false,
    installDir: resolvedInstallDir,
    cloudRegion: finalArgs.region ?? undefined,
    default: finalArgs.default ?? false,
    signup: finalArgs.signup ?? false,
    localMcp: finalArgs.localMcp ?? false,
    ci: finalArgs.ci ?? false,
    apiKey: finalArgs.apiKey,
    menu: finalArgs.menu ?? false,
  };

  clack.intro(`Welcome to the PostHog setup wizard ✨`);

  if (wizardOptions.ci) {
    clack.log.info(chalk.dim('Running in CI mode'));
  }

  const integration =
    finalArgs.integration ?? (await getIntegrationForSetup(wizardOptions));

  analytics.setTag('integration', integration);

  const config = FRAMEWORK_REGISTRY[integration];

  try {
    await runAgentWizard(config, wizardOptions);
  } catch (error) {
    analytics.captureException(error as Error, {
      integration,
      arguments: JSON.stringify(finalArgs),
    });

    await analytics.shutdown('error');

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack =
      error instanceof Error && error.stack ? error.stack : undefined;

    // Log to file for debugging
    logToFile(`[Wizard run.ts] ERROR MESSAGE: ${errorMessage} `);
    if (errorStack) {
      logToFile(`[Wizard run.ts] ERROR STACK: ${errorStack}`);
    }

    clack.log.error(
      `Something went wrong: ${chalk.red(
        errorMessage,
      )}\n\nYou can read the documentation at ${chalk.cyan(
        config.metadata.docsUrl,
      )} to set up PostHog manually.`,
    );

    if (wizardOptions.debug && errorStack) {
      clack.log.info(chalk.dim(errorStack));
    }

    process.exit(1);
  }
}

const DETECTION_TIMEOUT_MS = 5000;

async function detectIntegration(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<Integration | undefined> {
  for (const integration of Object.values(Integration)) {
    const config = FRAMEWORK_REGISTRY[integration];
    try {
      const detected = await Promise.race([
        config.detection.detect(options),
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

async function getIntegrationForSetup(
  options: Pick<WizardOptions, 'installDir' | 'menu'>,
) {
  if (!options.menu) {
    const detectedIntegration = await detectIntegration(options);

    if (detectedIntegration) {
      clack.log.success(
        `Detected integration: ${FRAMEWORK_REGISTRY[detectedIntegration].metadata.name}`,
      );
      return detectedIntegration;
    }

    clack.log.info(
      "I couldn't detect your framework. Please choose one to get started.",
    );
  }

  const integration: Integration = await abortIfCancelled(
    clack.select({
      message: 'What do you want to set up?',
      options: Object.values(Integration).map((value) => ({
        value,
        label: FRAMEWORK_REGISTRY[value].metadata.name,
      })),
    }),
  );

  return integration;
}
