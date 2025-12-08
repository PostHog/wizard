import { abortIfCancelled, getPackageDotJson } from './utils/clack-utils';

import { runNextjsWizard } from './nextjs/nextjs-wizard';
import { runNextjsWizardAgent } from './nextjs/nextjs-wizard-agent';
import type { CloudRegion, WizardOptions } from './utils/types';

import {
  getIntegrationDescription,
  Integration,
  FeatureFlagDefinition,
  WizardVariant,
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
import { EventEmitter } from 'events';
import chalk from 'chalk';
import { RateLimitError } from './utils/errors';
import { getPackageVersion } from './utils/package-json';
import * as semver from 'semver';

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
  };

  clack.intro(`Welcome to the PostHog setup wizard ✨`);

  const integration =
    finalArgs.integration ?? (await getIntegrationForSetup(wizardOptions));

  analytics.setTag('integration', integration);

  try {
    switch (integration) {
      case Integration.nextjs:
        await chooseNextjsWizard(wizardOptions);
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
        { value: Integration.svelte, label: 'Svelte' },
        { value: Integration.reactNative, label: 'React Native' },
      ],
    }),
  );

  return integration;
}

async function chooseNextjsWizard(options: WizardOptions): Promise<void> {
  try {
    const packageJson = await getPackageDotJson(options);
    const nextVersion = getPackageVersion('next', packageJson);

    // If Next.js < 15, use legacy wizard
    if (nextVersion) {
      const coercedVersion = semver.coerce(nextVersion);
      if (coercedVersion && semver.lt(coercedVersion, '15.3.0')) {
        await runNextjsWizard(options);
        return;
      }
    }

    // Next.js >= 15 - check feature flag to determine which wizard to use
    const flagValue = await analytics.getFeatureFlag(
      FeatureFlagDefinition.NextV2,
    );

    if (flagValue === WizardVariant.Agent) {
      await runNextjsWizardAgent(options);
    } else {
      await runNextjsWizard(options);
    }
  } catch (error) {
    await runNextjsWizard(options);
  }
}
