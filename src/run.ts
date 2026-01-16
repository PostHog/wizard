import { abortIfCancelled } from './utils/clack-utils';

import { runNextjsWizardAgent } from './nextjs/nextjs-wizard-agent';
import type { CloudRegion, WizardOptions } from './utils/types';

import {
  getIntegrationDescription,
  Integration,
  FeatureFlagDefinition,
} from './lib/constants';
import { readEnvironment } from './utils/environment';
import clack from './utils/clack';
import path from 'path';
import { INTEGRATION_CONFIG, INTEGRATION_ORDER } from './lib/config';
import { runReactWizard } from './react/react-wizard';
import { analytics } from './utils/analytics';
import { runSvelteWizard } from './svelte/svelte-wizard';
import { runReactNativeWizard } from './react-native/react-native-wizard';
import { runAstroWizard } from './astro/astro-wizard';
import { runReactRouterWizardAgent } from './react-router/react-router-wizard-agent';
import { runDjangoWizardAgent } from './django/django-wizard-agent';
import { EventEmitter } from 'events';
import chalk from 'chalk';
import { RateLimitError } from './utils/errors';

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

  try {
    switch (integration) {
      case Integration.nextjs:
        await runNextjsWizardAgent(wizardOptions);
        break;
      case Integration.react:
        await runReactWizard(wizardOptions);
        break;
      case Integration.svelte:
        await runSvelteWizard(wizardOptions);
        break;
      case Integration.reactNative:
        await runReactNativeWizard(wizardOptions);
        break;
      case Integration.astro:
        await runAstroWizard(wizardOptions);
        break;
      case Integration.reactRouter: {
        const flagValue = await analytics.getFeatureFlag(
          FeatureFlagDefinition.ReactRouter,
        );
        // In CI mode, bypass feature flags and always use the React Router wizard
        if (wizardOptions.ci || flagValue === true) {
          await runReactRouterWizardAgent(wizardOptions);
        } else {
          await runReactWizard(wizardOptions);
        }
        break;
      }
      case Integration.django: {
        // Always run Django wizard when using local MCP (for development)
        // Otherwise check feature flag
        const flagValue = wizardOptions.localMcp
          ? true
          : await analytics.getFeatureFlag(FeatureFlagDefinition.Django);
        if (flagValue === true) {
          await runDjangoWizardAgent(wizardOptions);
        } else {
          // No legacy wizard for Django - show manual docs
          clack.log.info(
            `The Django wizard is not yet available. Please follow our documentation to set up PostHog manually: ${chalk.cyan(
              INTEGRATION_CONFIG[Integration.django].docsUrl,
            )}`,
          );
          clack.outro('PostHog wizard will see you next time!');
        }
        break;
      }
      default:
        clack.log.error('No setup wizard selected!');
    }
  } catch (error) {
    analytics.captureException(error as Error, {
      integration,
      arguments: JSON.stringify(finalArgs),
    });

    await analytics.shutdown('error');

    if (error instanceof RateLimitError) {
      clack.log.error('Wizard usage limit reached. Please try again later.');
    } else {
      clack.log.error(
        `Something went wrong. You can read the documentation at ${chalk.cyan(
          `${INTEGRATION_CONFIG[integration].docsUrl}`,
        )} to set up PostHog manually.`,
      );
    }
    process.exit(1);
  }
}

async function detectIntegration(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<Integration | undefined> {
  const integrationConfigs = Object.entries(INTEGRATION_CONFIG).sort(
    ([a], [b]) =>
      INTEGRATION_ORDER.indexOf(a as Integration) -
      INTEGRATION_ORDER.indexOf(b as Integration),
  );

  for (const [integration, config] of integrationConfigs) {
    const detected = await config.detect(options);
    if (detected) {
      return integration as Integration;
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
      options: [
        { value: Integration.nextjs, label: 'Next.js' },
        { value: Integration.astro, label: 'Astro' },
        { value: Integration.react, label: 'React' },
        { value: Integration.reactRouter, label: 'React Router' },
        { value: Integration.django, label: 'Django' },
        { value: Integration.svelte, label: 'Svelte' },
        { value: Integration.reactNative, label: 'React Native' },
      ],
    }),
  );

  return integration;
}
