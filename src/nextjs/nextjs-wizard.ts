/* eslint-disable max-lines */

import chalk from 'chalk';
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
import { getPackageVersion, hasPackageInstalled } from '../utils/package-json';
import {
  getNextJsRouter,
  getNextJsRouterName,
  getNextJsVersionBucket,
  NextJsRouter,
} from './utils';
import clack from '../utils/clack';
import { Integration, ISSUES_URL } from '../lib/constants';
import { getNextjsAppRouterDocs, getNextjsPagesRouterDocs } from './docs';
import { analytics } from '../utils/analytics';
import { addOrUpdateEnvironmentVariables } from '../utils/environment';
import {
  generateFileChangesForIntegration,
  getFilesToChange,
  getRelevantFilesForIntegration,
} from '../utils/file-utils';
import type { WizardOptions } from '../utils/types';
import { askForCloudRegion } from '../utils/clack-utils';
import { installRules } from '../rules/install-rules';
import path from 'path';

export async function runNextjsWizard(options: WizardOptions): Promise<void> {
  printWelcome({
    wizardName: 'PostHog Next.js Wizard',
  });

  const aiConsent = await askForAIConsent(options);

  if (!aiConsent) {
    await abort(
      'The Next.js wizard requires AI to get setup right now. Please view the docs to setup Next.js manually instead: https://posthog.com/docs/libraries/next-js',
      0,
    );
  }

  const cloudRegion = options.cloudRegion ?? (await askForCloudRegion());

  const typeScriptDetected = isUsingTypeScript(options);

  await confirmContinueIfNoOrDirtyGitRepo(options);

  const packageJson = await getPackageDotJson(options);

  await ensurePackageIsInstalled(packageJson, 'next', 'Next.js');

  const nextVersion = getPackageVersion('next', packageJson);

  analytics.setTag('nextjs-version', getNextJsVersionBucket(nextVersion));

  const { projectApiKey, wizardHash, host } = await getOrAskForProjectData({
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
      integration: Integration.nextjs,
    });

  await installPackage({
    packageName: 'posthog-node',
    packageNameDisplayLabel: 'posthog-node',
    packageManager: packageManagerFromInstallStep,
    alreadyInstalled: !!packageJson?.dependencies?.['posthog-node'],
    forceInstall: options.forceInstall,
    askBeforeUpdating: false,
    installDir: options.installDir,
    integration: Integration.nextjs,
  });

  const router = await getNextJsRouter(options);

  const relevantFiles = await getRelevantFilesForIntegration({
    installDir: options.installDir,
    integration: Integration.nextjs,
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
    integration: Integration.nextjs,
    relevantFiles,
    documentation: installationDocumentation,
    wizardHash,
    cloudRegion,
  });

  await generateFileChangesForIntegration({
    integration: Integration.nextjs,
    filesToChange,
    wizardHash,
    installDir: options.installDir,
    documentation: installationDocumentation,
    cloudRegion,
  });

  await addOrUpdateEnvironmentVariables({
    variables: {
      NEXT_PUBLIC_POSTHOG_KEY: projectApiKey,
    },
    installDir: options.installDir,
    integration: Integration.nextjs,
  });

  const packageManagerForOutro =
    packageManagerFromInstallStep ?? (await getPackageManager(options));

  await runPrettierIfInstalled({
    installDir: options.installDir,
    integration: Integration.nextjs,
  });

  await installRules('next-rules.md', options.installDir);

  clack.outro(`${chalk.green('Successfully installed PostHog!')} ${`\n\n${aiConsent
    ? `Note: This uses experimental AI to setup your project. It might have got it wrong, please check!\n`
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

