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
import { getReactNativeDocumentation } from './docs';
import { analytics } from '../utils/analytics';
import {
  generateFileChangesForIntegration,
  getFilesToChange,
  getRelevantFilesForIntegration,
} from '../utils/file-utils';
import type { WizardOptions } from '../utils/types';
import { askForCloudRegion } from '../utils/clack-utils';
import {
  addEditorRulesStep,
  addMCPServerToClientsStep,
  runPrettierStep,
} from '../steps';
import { EXPO } from '../utils/package-manager';
import { getOutroMessage } from '../lib/messages';

export async function runReactNativeWizard(
  options: WizardOptions,
): Promise<void> {
  printWelcome({
    wizardName: 'PostHog React Native wizard',
  });

  const aiConsent = await askForAIConsent(options);

  if (!aiConsent) {
    await abort(
      'The React Native wizard requires AI to get setup right now. Please view the docs to setup React Native manually instead: https://posthog.com/docs/libraries/react-native',
      0,
    );
  }

  const cloudRegion = options.cloudRegion ?? (await askForCloudRegion());

  const typeScriptDetected = isUsingTypeScript(options);

  await confirmContinueIfNoOrDirtyGitRepo(options);

  const packageJson = await getPackageDotJson(options);

  await ensurePackageIsInstalled(packageJson, 'react-native', 'React Native');

  const reactNativeVersion = getPackageVersion('react-native', packageJson);

  if (reactNativeVersion) {
    analytics.setTag('react-native-version', reactNativeVersion);
  }

  const { projectApiKey, accessToken, host } = await getOrAskForProjectData({
    ...options,
    cloudRegion,
  });

  const sdkAlreadyInstalled = hasPackageInstalled('posthog-js', packageJson);

  analytics.setTag('sdk-already-installed', sdkAlreadyInstalled);

  const isUsingExpo = hasPackageInstalled('expo', packageJson);

  if (isUsingExpo) {
    analytics.setTag('is-using-expo', true);
    analytics.setTag('expo-version', getPackageVersion('expo', packageJson));
  }

  clack.log.info(`Detected ${isUsingExpo ? 'Expo' : 'React Native'}`);

  const packagesToInstall = isUsingExpo
    ? [
        'posthog-react-native',
        'posthog-react-native-session-replay',
        'expo-file-system',
        'expo-application',
        'expo-device',
        'expo-localization',
      ]
    : [
        'posthog-react-native',
        '@react-native-async-storage/async-storage',
        'react-native-device-info',
        'react-native-localize',
      ];

  for (const packageName of packagesToInstall) {
    await installPackage({
      packageName,
      packageNameDisplayLabel: packageName,
      alreadyInstalled: !!packageJson?.dependencies?.[packageName],
      forceInstall: options.forceInstall,
      askBeforeUpdating: false,
      installDir: options.installDir,
      integration: Integration.reactNative,
      packageManager: isUsingExpo ? EXPO : undefined,
    });
  }

  const relevantFiles = await getRelevantFilesForIntegration({
    installDir: options.installDir,
    integration: Integration.reactNative,
  });

  const installationDocumentation = getReactNativeDocumentation({
    language: typeScriptDetected ? 'typescript' : 'javascript',
    host,
    projectApiKey,
  });

  clack.log.info(
    `Reviewing PostHog documentation for ${
      isUsingExpo ? 'Expo' : 'React Native'
    }`,
  );

  const filesToChange = await getFilesToChange({
    integration: Integration.reactNative,
    relevantFiles,
    documentation: installationDocumentation,
    accessToken,
    cloudRegion,
  });

  await generateFileChangesForIntegration({
    integration: Integration.reactNative,
    filesToChange,
    accessToken,
    installDir: options.installDir,
    documentation: installationDocumentation,
    cloudRegion,
  });

  await runPrettierStep({
    installDir: options.installDir,
    integration: Integration.reactNative,
  });

  const addedEditorRules = await addEditorRulesStep({
    installDir: options.installDir,
    rulesName: 'react-native-rules.md',
    integration: Integration.reactNative,
  });

  await addMCPServerToClientsStep({
    cloudRegion,
    integration: Integration.reactNative,
  });

  const packageManagerForOutro = await getPackageManager({
    installDir: options.installDir,
  });

  const outroMessage = getOutroMessage({
    options,
    integration: Integration.reactNative,
    cloudRegion,
    addedEditorRules,
    packageManager: packageManagerForOutro,
    uploadedEnvVars: [],
  });

  clack.outro(outroMessage);

  await analytics.shutdown('success');
}
