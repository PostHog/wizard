/* eslint-disable max-lines */

import chalk from 'chalk';
import * as fs from 'fs';
import { z } from 'zod';
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
  runPrettierIfInstalled,
} from '../utils/clack-utils';
import type { FileChange, WizardOptions } from '../utils/types';
import { getPackageVersion, hasPackageInstalled } from '../utils/package-json';
import {
  getNextJsRouter,
  getNextJsRouterName,
  getNextJsVersionBucket,
  NextJsRouter,
} from './utils';
import { query } from '../utils/query';
import clack from '../utils/clack';
import path from 'path';
import { Integration, ISSUES_URL } from '../lib/constants';
import { getNextjsAppRouterDocs, getNextjsPagesRouterDocs } from './docs';
import { analytics } from '../utils/analytics';
import { getFilterFilesPromptTemplate, getGenerateFileChangesPromptTemplate } from './prompts';
import { getRelevantFilesForIntegration } from '../react/utils';
import { addOrUpdateEnvironmentVariables } from '../utils/environment';
import { generateFileChanges, getFilesToChange, updateFile } from '../utils/file-utils';


export async function runNextjsWizard(options: WizardOptions): Promise<void> {
  const { forceInstall } = options;

  printWelcome({
    wizardName: 'PostHog Next.js Wizard',
  });

  const aiConsent = await askForAIConsent();

  if (!aiConsent) {
    await abort(
      'The Next.js wizard requires AI to get setup right now. Please view the docs to setup Next.js manually instead: https://posthog.com/docs/libraries/next-js',
      0,
    );
  }

  const typeScriptDetected = isUsingTypeScript(options);

  await confirmContinueIfNoOrDirtyGitRepo();

  const packageJson = await getPackageDotJson(options);

  await ensurePackageIsInstalled(packageJson, 'next', 'Next.js');

  const nextVersion = getPackageVersion('next', packageJson);

  analytics.setTag('nextjs-version', getNextJsVersionBucket(nextVersion));

  const { projectApiKey, wizardHash, host } = await getOrAskForProjectData(
    options,
  );

  const sdkAlreadyInstalled = hasPackageInstalled('posthog-js', packageJson);

  analytics.setTag('sdk-already-installed', sdkAlreadyInstalled);

  const { packageManager: packageManagerFromInstallStep } =
    await installPackage({
      packageName: 'posthog-js',
      packageNameDisplayLabel: 'posthog-js',
      alreadyInstalled: !!packageJson?.dependencies?.['posthog-js'],
      forceInstall,
      askBeforeUpdating: false,
      installDir: options.installDir,
      integration: Integration.nextjs,
    });

  await installPackage({
    packageName: 'posthog-node',
    packageNameDisplayLabel: 'posthog-node',
    packageManager: packageManagerFromInstallStep,
    alreadyInstalled: !!packageJson?.dependencies?.['posthog-node'],
    forceInstall,
    askBeforeUpdating: false,
    installDir: options.installDir,
    integration: Integration.nextjs,
  });

  const router = await getNextJsRouter(options);

  const relevantFiles = await getRelevantFilesForIntegration({ ...options, integration: Integration.nextjs });

  analytics.capture('wizard interaction', {
    action: 'detected relevant files',
    integration: Integration.nextjs,
    number_of_files: relevantFiles.length,
  });

  const installationDocumentation = getInstallationDocumentation({
    router,
    host,
    language: typeScriptDetected ? 'typescript' : 'javascript',
  });

  clack.log.info(
    `Reviewing PostHog documentation for ${getNextJsRouterName(router)}`,
  );

  const filesToChange = await getFilesToChange({
    prompt: await (await getFilterFilesPromptTemplate()).format({
      documentation: installationDocumentation,
      file_list: relevantFiles.join('\n'),
    }),
    wizardHash,
  });

  analytics.capture('wizard interaction', {
    action: 'detected files to change',
    integration: Integration.nextjs,
    files: filesToChange,
  });


  await addOrUpdateEnvironmentVariables({
    variables: {
      NEXT_PUBLIC_POSTHOG_KEY: projectApiKey,
    },
    installDir: options.installDir,
  });

  analytics.capture('wizard interaction', {
    action: 'added environment variables',
    integration: Integration.nextjs,
  });

  const packageManagerForOutro =
    packageManagerFromInstallStep ?? (await getPackageManager(options));

  await runPrettierIfInstalled({
    installDir: options.installDir,
    integration: Integration.nextjs,
  });

  clack.outro(`
${chalk.green('Successfully installed PostHog!')} ${`\n\n${aiConsent
      ? `Note: This uses experimental AI to setup your project. It might have got it wrong, pleaes check!\n`
      : ``
    }You should validate your setup by (re)starting your dev environment (e.g. ${chalk.cyan(
      `${packageManagerForOutro.runScriptCommand} dev`,
    )})`}

${chalk.dim(`If you encounter any issues, let us know here: ${ISSUES_URL}`)}`);

  await analytics.shutdown('success');
}



function getInstallationDocumentation({
  router,
  host,
  language,
}: {
  router: NextJsRouter;
  host: string;
  language: 'typescript' | 'javascript';
}) {
  if (router === NextJsRouter.PAGES_ROUTER) {
    return getNextjsPagesRouterDocs({ host, language });
  }

  return getNextjsAppRouterDocs({ host, language });
}



