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
import {
  getNextJsRouter,
  getNextJsRouterName,
  getNextJsVersionBucket,
  NextJsRouter,
} from './utils';
import clack from '../utils/clack';
import { Integration } from '../lib/constants';
import {
  getNextjsAppRouterDocs,
  getNextjsPagesRouterDocs,
  getModernNextjsDocs,
} from './docs';
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
  addOrUpdateEnvironmentVariablesStep,
  createPRStep,
  runPrettierStep,
} from '../steps';
import { uploadEnvironmentVariablesStep } from '../steps/upload-environment-variables';
import * as semver from 'semver';

export async function runNextjsWizard(options: WizardOptions): Promise<void> {
  printWelcome({
    wizardName: 'PostHog Next.js wizard',
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

  const relevantFiles = await getRelevantFilesForIntegration({
    installDir: options.installDir,
    integration: Integration.nextjs,
  });

  let installationDocumentation;

  if (instrumentationFileAvailable(nextVersion)) {
    installationDocumentation = getModernNextjsDocs({
      host,
      language: typeScriptDetected ? 'typescript' : 'javascript',
    });

    clack.log.info(
      `Reviewing PostHog documentation for instrumentation-client.${
        typeScriptDetected ? 'ts' : 'js'
      }`,
    );
  } else {
    const router = await getNextJsRouter(options);

    installationDocumentation = getInstallationDocumentation({
      router,
      host,
      language: typeScriptDetected ? 'typescript' : 'javascript',
    });

    clack.log.info(
      `Reviewing PostHog documentation for ${getNextJsRouterName(router)}`,
    );
  }

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

  const packageManagerForOutro =
    packageManagerFromInstallStep ?? (await getPackageManager(options));

  await runPrettierStep({
    installDir: options.installDir,
    integration: Integration.nextjs,
  });

  const { relativeEnvFilePath, addedEnvVariables } =
    await addOrUpdateEnvironmentVariablesStep({
      variables: {
        NEXT_PUBLIC_POSTHOG_KEY: projectApiKey,
        NEXT_PUBLIC_POSTHOG_HOST: host,
      },
      installDir: options.installDir,
      integration: Integration.nextjs,
    });

  const uploadedEnvVars = await uploadEnvironmentVariablesStep(
    {
      NEXT_PUBLIC_POSTHOG_KEY: projectApiKey,
      NEXT_PUBLIC_POSTHOG_HOST: host,
    },
    {
      integration: Integration.nextjs,
      options,
    },
  );

  const addedEditorRules = await addEditorRulesStep({
    rulesName: 'next-rules.md',
    installDir: options.installDir,
    integration: Integration.nextjs,
    default: options.default,
  });

  const prUrl = await createPRStep({
    installDir: options.installDir,
    integration: Integration.nextjs,
    addedEditorRules,
  });

  const outroMessage = getOutroMessage({
    options,
    integration: Integration.nextjs,
    cloudRegion,
    addedEditorRules,
    packageManager: packageManagerForOutro,
    envFileChanged: addedEnvVariables ? relativeEnvFilePath : undefined,
    prUrl,
    uploadedEnvVars,
  });

  clack.outro(outroMessage);

  await analytics.shutdown('success');
}

function instrumentationFileAvailable(
  nextVersion: string | undefined,
): boolean {
  const minimumVersion = '15.3.0'; //instrumentation-client.js|ts was introduced in 15.3

  if (!nextVersion) {
    return false;
  }
  const coercedNextVersion = semver.coerce(nextVersion);
  if (!coercedNextVersion) {
    return false; // Unable to parse nextVersion
  }
  return semver.gte(coercedNextVersion, minimumVersion);
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
