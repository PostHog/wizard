import { abortIfCancelled } from './utils/clack-utils';

import { runNextjsWizard } from './nextjs/nextjs-wizard';
import type { CloudRegion, WizardOptions } from './utils/types';

import { getIntegrationDescription, Integration } from './lib/constants';
import { readEnvironment } from './utils/environment';
import clack from './utils/clack';
import path from 'path';
import { INTEGRATION_CONFIG, INTEGRATION_ORDER } from './lib/config';
import { runReactWizard } from './react/react-wizard';
import { analytics } from './utils/analytics';
import { runSvelteWizard } from './svelte/svelte-wizard';
import { runReactNativeWizard } from './react-native/react-native-wizard';
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
};

export async function runWizard(argv: Args) {
  const finalArgs = {
    ...argv,
    ...readEnvironment(),
  };

  const wizardOptions: WizardOptions = {
    debug: finalArgs.debug ?? false,
    forceInstall: finalArgs.forceInstall ?? false,
    installDir: finalArgs.installDir
      ? path.join(process.cwd(), finalArgs.installDir)
      : process.cwd(),
    cloudRegion: finalArgs.region ?? undefined,
    default: finalArgs.default ?? false,
    signup: finalArgs.signup ?? false,
  };

  clack.intro(`Welcome to the PostHog setup wizard ✨`);

  const integration =
    finalArgs.integration ?? (await getIntegrationForSetup(wizardOptions));

  analytics.setTag('integration', integration);

  try {
    switch (integration) {
      case Integration.nextjs:
        await runNextjsWizard(wizardOptions);
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
      default:
        clack.log.error('No setup wizard selected!');
    }
  } catch (error) {
    clack.log.error(
      `Something went wrong. You can read the documentation for PostHog at ${chalk.cyan(
        `${INTEGRATION_CONFIG[integration].docsUrl}`,
      )} to setup PostHog manually.`,
    );
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
        { value: Integration.react, label: 'React' },
        { value: Integration.svelte, label: 'Svelte' },
        { value: Integration.reactNative, label: 'React Native' },
      ],
    }),
  );

  return integration;
}
