import { abortIfCancelled } from './utils/clack-utils';

import type { CloudRegion, WizardOptions } from './utils/types';

import {
  getIntegrationDescription,
  Integration,
  INTEGRATION_LABELS,
} from './lib/constants';
import { readEnvironment } from './utils/environment';
import clack from './utils/clack';
import path from 'path';
import { FRAMEWORK_REGISTRY } from './lib/registry';
import { analytics } from './utils/analytics';
import { runAgentWizard } from './lib/agent-runner';
import { EventEmitter } from 'events';
import chalk from 'chalk';

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

    clack.log.error(
      `Something went wrong. You can read the documentation at ${chalk.cyan(
        config.metadata.docsUrl,
      )} to set up PostHog manually.`,
    );
    process.exit(1);
  }
}

async function detectIntegration(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<Integration | undefined> {
  for (const integration of Object.values(Integration)) {
    const config = FRAMEWORK_REGISTRY[integration];
    const detected = await config.detection.detect(options);
    if (detected) {
      return integration;
    }
  }
}

async function getIntegrationForSetup(
  options: Pick<WizardOptions, 'installDir'>,
) {
  const detectedIntegration = await detectIntegration(options);

  if (detectedIntegration) {
    clack.log.success(
      `Detected integration: ${getIntegrationDescription(detectedIntegration)}`,
    );
    return detectedIntegration;
  }

  const integration: Integration = await abortIfCancelled(
    clack.select({
      message: 'What do you want to set up?',
      options: Object.values(Integration).map((value) => ({
        value,
        label: INTEGRATION_LABELS[value],
      })),
    }),
  );

  return integration;
}
