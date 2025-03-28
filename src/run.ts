import { abortIfCancelled } from './utils/clack-utils';

import type { CloudRegion, WizardOptions } from './utils/types';
import { detectNextJs, runNextjsWizard } from './nextjs/nextjs-wizard';

import { getIntegrationDescription, Integration } from './lib/constants';
import { readEnvironment } from './utils/environment';
import clack from './utils/clack';
import path from 'path';

type Args = {
  integration?: Integration;
  debug?: boolean;
  forceInstall?: boolean;
  installDir?: string;
  region?: CloudRegion;
  default?: boolean;
};

export async function run(argv: Args) {
  await runWizard(argv);
}

async function runWizard(argv: Args) {
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
  };

  clack.intro(`Welcome to the PostHog setup wizard ✨`);

  const integration =
    finalArgs.integration ?? (await getIntegrationForSetup(wizardOptions));

  switch (integration) {
    case Integration.nextjs:
      await runNextjsWizard(wizardOptions);
      break;

    default:
      clack.log.error('No setup wizard selected!');
  }
}

async function detectIntegration(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<Integration | undefined> {
  const detectors = [detectNextJs];

  for (const detector of detectors) {
    const integration = await detector(options);
    if (integration) {
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
      options: [{ value: Integration.nextjs, label: 'Next.js' }],
    }),
  );

  return integration;
}
