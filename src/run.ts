import { abortIfCancelled } from './utils/clack-utils';

import type { WizardOptions } from './utils/types';
import { detectNextJs, runNextjsWizard } from './nextjs/nextjs-wizard';

import { getIntegrationDescription, Integration } from './lib/constants';
import { readEnvironment } from './utils/environment';
import clack from './utils/clack';

type Args = {
  integration?: Integration;
  debug?: boolean;
  forceInstall?: boolean;
};
export async function run(argv: Args) {
  const finalArgs = {
    ...argv,
    ...readEnvironment(),
  };


  clack.intro(`Welcome to the PostHog setup wizard ✨`);

  const integration = finalArgs.integration ?? await getIntegrationForSetup();


  const wizardOptions: WizardOptions = {
    debug: finalArgs.debug ?? false,
    forceInstall: finalArgs.forceInstall ?? false,
    telemetryEnabled: false,
  };

  switch (integration) {
    case Integration.nextjs:
      await runNextjsWizard(wizardOptions);
      break;

    default:
      clack.log.error('No setup wizard selected!');
  }
}


async function detectIntegration(): Promise<Integration | undefined> {

  const detectors = [
    detectNextJs
  ]

  for (const detector of detectors) {
    const integration = await detector();
    if (integration) {
      return integration;
    }
  }
}

async function getIntegrationForSetup() {

  const detectedIntegration = await detectIntegration();

  if (detectedIntegration) {
    clack.log.success(`Detected integration: ${getIntegrationDescription(detectedIntegration)}`);
    return detectedIntegration;
  }

  const integration: Integration = await abortIfCancelled(
    clack.select({
      message: 'What do you want to set up?',
      options: [{ value: Integration.nextjs, label: 'Next.js' }],
    }),
  );

  return integration;
}
