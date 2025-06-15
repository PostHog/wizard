/* eslint-disable max-lines */

import {
  abort,
  askForAIConsent,
  confirmContinueIfNoOrDirtyGitRepo,
  ensurePackageIsInstalled,
  getOrAskForProjectData,
  getPackageDotJson,
  printWelcome,
} from '../utils/clack-utils';
import { getPackageVersion } from '../utils/package-json';
import clack from '../utils/clack';
import { Integration } from '../lib/constants';
import { getAstroDocumentation } from './docs';
import { analytics } from '../utils/analytics';
import {
  generateFileChangesForIntegration,
  getFilesToChange,
  getRelevantFilesForIntegration,
} from '../utils/file-utils';
import type { WizardOptions } from '../utils/types';
import { askForCloudRegion } from '../utils/clack-utils';
import { getOutroMessage } from '../lib/messages';
import {
  addEditorRulesStep,
  addMCPServerToClientsStep,
  runPrettierStep,
} from '../steps';

export async function runAstroWizard(options: WizardOptions): Promise<void> {
  printWelcome({
    wizardName: 'PostHog Astro wizard',
  });

  const aiConsent = await askForAIConsent(options);

  if (!aiConsent) {
    await abort(
      'The Astro wizard requires AI to get setup right now. Please view the docs to setup Astro manually instead: https://posthog.com/docs/libraries/js',
      0,
    );
  }

  const cloudRegion = options.cloudRegion ?? (await askForCloudRegion());

  await confirmContinueIfNoOrDirtyGitRepo(options);

  const packageJson = await getPackageDotJson(options);

  await ensurePackageIsInstalled(packageJson, 'astro', 'Astro');

  const astroVersion = getPackageVersion('astro', packageJson);

  if (astroVersion) {
    analytics.setTag('astro-version', astroVersion);
  }

  const { projectApiKey, wizardHash, host } = await getOrAskForProjectData({
    ...options,
    cloudRegion,
  });

  clack.log.info('Heading to include the PostHogSnippet in your Astro project');

  const relevantFiles = await getRelevantFilesForIntegration({
    installDir: options.installDir,
    integration: Integration.astro,
  });

  const installationDocumentation = getAstroDocumentation({
    projectApiKey,
    host,
  });

  clack.log.info('Reviewing PostHog documentation for Astro');

  const filesToChange = await getFilesToChange({
    integration: Integration.astro,
    relevantFiles,
    documentation: installationDocumentation,
    wizardHash,
    cloudRegion,
  });

  await generateFileChangesForIntegration({
    integration: Integration.astro,
    filesToChange,
    wizardHash,
    installDir: options.installDir,
    documentation: installationDocumentation,
    cloudRegion,
  });

  await runPrettierStep({
    installDir: options.installDir,
    integration: Integration.astro,
  });

  const addedEditorRules = await addEditorRulesStep({
    installDir: options.installDir,
    rulesName: 'astro-rules.md',
    integration: Integration.astro,
  });

  await addMCPServerToClientsStep({
    cloudRegion,
    integration: Integration.astro,
  });

  const outroMessage = getOutroMessage({
    options,
    integration: Integration.astro,
    cloudRegion,
    addedEditorRules,
    uploadedEnvVars: [],
  });

  clack.outro(outroMessage);

  await analytics.shutdown('success');
}
