/* eslint-disable max-lines */

import {
  abort,
  askForAIConsent,
  confirmContinueIfNoOrDirtyGitRepo,
  ensurePackageIsInstalled,
  getOrAskForProjectData,
  getPackageDotJson,
  getPackageManager,
  installPackage,
  isUsingTypeScript,
  printWelcome,
} from '../utils/clack-utils';
import { getPackageVersion, hasPackageInstalled } from '../utils/package-json';
import clack from '../utils/clack';
import { Integration } from '../lib/constants';
import { getSvelteDocumentation } from './docs';
import { analytics } from '../utils/analytics';
import {
  generateFileChangesForIntegration,
  getFilesToChange,
  getRelevantFilesForIntegration,
} from '../utils/file-utils';
import type { WizardOptions } from '../utils/types';
import { askForCloudRegion } from '../utils/clack-utils';
import { addEditorRulesStep } from '../steps/add-editor-rules';
import { getOutroMessage } from '../lib/messages';
import {
  addMCPServerToClientsStep,
  addOrUpdateEnvironmentVariablesStep,
  runPrettierStep,
} from '../steps';

export async function runSvelteWizard(options: WizardOptions): Promise<void> {
  printWelcome({
    wizardName: 'PostHog Svelte wizard',
  });

  const aiConsent = await askForAIConsent(options);

  if (!aiConsent) {
    await abort(
      'The Svelte wizard requires AI to get setup right now. Please view the docs to setup Svelte manually instead: https://posthog.com/docs/libraries/svelte',
      0,
    );
  }

  const cloudRegion = options.cloudRegion ?? (await askForCloudRegion());

  const typeScriptDetected = isUsingTypeScript(options);

  await confirmContinueIfNoOrDirtyGitRepo(options);

  const packageJson = await getPackageDotJson(options);

  await ensurePackageIsInstalled(packageJson, '@sveltejs/kit', '@sveltejs/kit');

  const svelteVersion = getPackageVersion('@sveltejs/kit', packageJson);

  if (svelteVersion) {
    analytics.setTag('svelte-version', svelteVersion);
  }

  const { projectApiKey, accessToken, host, projectId } =
    await getOrAskForProjectData({
      ...options,
      cloudRegion,
    });

  const sdkAlreadyInstalled = hasPackageInstalled('posthog-js', packageJson);

  analytics.setTag('sdk-already-installed', sdkAlreadyInstalled);

  const { packageManager: packageManagerFromInstallStep } =
    await installPackage({
      packageName: 'posthog-js',
      packageNameDisplayLabel: 'posthog-js',
      alreadyInstalled: !!packageJson?.dependencies?.['posthog-js'],
      forceInstall: options.forceInstall,
      askBeforeUpdating: false,
      installDir: options.installDir,
      integration: Integration.svelte,
    });

  await installPackage({
    packageName: 'posthog-node',
    packageNameDisplayLabel: 'posthog-node',
    packageManager: packageManagerFromInstallStep,
    alreadyInstalled: !!packageJson?.dependencies?.['posthog-node'],
    forceInstall: options.forceInstall,
    askBeforeUpdating: false,
    installDir: options.installDir,
    integration: Integration.svelte,
  });

  const relevantFiles = await getRelevantFilesForIntegration({
    installDir: options.installDir,
    integration: Integration.svelte,
  });

  const installationDocumentation = getSvelteDocumentation({
    language: typeScriptDetected ? 'typescript' : 'javascript',
  });

  clack.log.info(`Reviewing PostHog documentation for Svelte`);

  const filesToChange = await getFilesToChange({
    integration: Integration.svelte,
    relevantFiles,
    documentation: installationDocumentation,
    accessToken,
    cloudRegion,
    projectId,
  });

  await generateFileChangesForIntegration({
    integration: Integration.svelte,
    filesToChange,
    accessToken,
    installDir: options.installDir,
    documentation: installationDocumentation,
    cloudRegion,
    projectId,
  });

  const { relativeEnvFilePath, addedEnvVariables } =
    await addOrUpdateEnvironmentVariablesStep({
      variables: {
        ['PUBLIC_POSTHOG_KEY']: projectApiKey,
        ['PUBLIC_POSTHOG_HOST']: host,
      },
      installDir: options.installDir,
      integration: Integration.svelte,
    });

  const packageManagerForOutro =
    packageManagerFromInstallStep ?? (await getPackageManager(options));

  await runPrettierStep({
    installDir: options.installDir,
    integration: Integration.svelte,
  });

  const addedEditorRules = await addEditorRulesStep({
    installDir: options.installDir,
    rulesName: 'svelte-rules.md',
    integration: Integration.svelte,
  });

  await addMCPServerToClientsStep({
    cloudRegion,
    integration: Integration.svelte,
  });

  const outroMessage = getOutroMessage({
    options,
    integration: Integration.svelte,
    cloudRegion,
    addedEditorRules,
    packageManager: packageManagerForOutro,
    envFileChanged: addedEnvVariables ? relativeEnvFilePath : undefined,
    uploadedEnvVars: [],
  });

  clack.outro(outroMessage);

  await analytics.shutdown('success');
}
