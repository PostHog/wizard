import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import path from 'path';
import chalk from 'chalk';
import z from 'zod';
import fg from 'fast-glob';

import {
  abort,
  abortIfCancelled,
  confirmContinueIfNoOrDirtyGitRepo,
  getOrAskForProjectData,
  getPackageDotJson,
  getPackageManager,
  installPackage,
  isUsingTypeScript,
  printWelcome,
  askForCloudRegion,
  askForAIConsent,
} from '../utils/clack-utils';
import clack from '../utils/clack';
import { analytics } from '../utils/analytics';
import { detectEnvVarPrefix } from '../utils/environment';
import { query } from '../utils/query';
import { updateFile, GLOBAL_IGNORE_PATTERN } from '../utils/file-utils';
import type { CloudRegion, FileChange, WizardOptions } from '../utils/types';
import type { PackageDotJson } from '../utils/package-json';
import { Integration } from '../lib/constants';
import {
  migrationFilterFilesPromptTemplate,
  migrationGenerateFileChangesPromptTemplate,
} from '../lib/prompts';
import {
  addEditorRulesStep,
  addMCPServerToClientsStep,
  addOrUpdateEnvironmentVariablesStep,
  runPrettierStep,
} from '../steps';
import { uploadEnvironmentVariablesStep } from '../steps/upload-environment-variables';
import type { PackageManager } from '../utils/package-manager';
import type {
  MigrationProviderConfig,
  InstalledPackage,
  MigrationOptions,
  MigrationOutroOptions,
} from './types';
import { getMigrationProvider } from './providers';

export function detectProviderInstallation(
  packageJson: PackageDotJson,
  provider: MigrationProviderConfig,
): InstalledPackage | undefined {
  for (const pkgName of provider.packages) {
    const version =
      packageJson?.dependencies?.[pkgName] ||
      packageJson?.devDependencies?.[pkgName];

    if (version) {
      return { packageName: pkgName, version };
    }
  }
  return undefined;
}

export function getAllInstalledProviderPackages(
  packageJson: PackageDotJson,
  provider: MigrationProviderConfig,
): InstalledPackage[] {
  const installedPackages: InstalledPackage[] = [];

  for (const pkgName of provider.packages) {
    const version =
      packageJson?.dependencies?.[pkgName] ||
      packageJson?.devDependencies?.[pkgName];

    if (version) {
      installedPackages.push({ packageName: pkgName, version });
    }
  }

  return installedPackages;
}

export async function runMigrationWizard(
  options: MigrationOptions,
  providerId: string,
): Promise<void> {
  const provider = getMigrationProvider(providerId);

  if (!provider) {
    clack.log.error(`Unknown migration provider: ${providerId}`);
    process.exit(1);
  }

  printWelcome({
    wizardName: `PostHog Migration Wizard`,
    message: `This wizard will help you migrate from ${provider.name} to PostHog.\nIt will replace ${provider.name} SDK code with PostHog equivalents.`,
  });

  const aiConsent = await askForAIConsent(options);

  if (!aiConsent) {
    await abort(
      `The migration wizard requires AI to work. Please view the docs to migrate manually: ${provider.docsUrl}`,
      0,
    );
  }

  const cloudRegion = options.cloudRegion ?? (await askForCloudRegion());

  await confirmContinueIfNoOrDirtyGitRepo(options);

  const packageJson = await getPackageDotJson(options);

  const providerInstallation = detectProviderInstallation(
    packageJson,
    provider,
  );

  if (!providerInstallation) {
    clack.log.warn(
      `No ${provider.name} SDK detected in your project. Are you sure you want to continue?`,
    );

    const continueAnyway = await abortIfCancelled(
      clack.confirm({
        message: 'Continue with migration anyway?',
        initialValue: false,
      }),
    );

    if (!continueAnyway) {
      await abort('Migration cancelled.', 0);
    }
  } else {
    clack.log.success(
      `Detected ${provider.name} installation: ${chalk.cyan(
        providerInstallation.packageName,
      )}@${providerInstallation.version}`,
    );
  }

  analytics.setTag('migration-source', providerId);
  analytics.setTag(`${providerId}-package`, providerInstallation?.packageName);

  const typeScriptDetected = isUsingTypeScript(options);
  const envVarPrefix = await detectEnvVarPrefix(options);

  const { projectApiKey, accessToken, host, projectId } =
    await getOrAskForProjectData({
      ...options,
      cloudRegion,
    });

  const framework = await detectFramework(options);
  analytics.setTag('migration-framework', framework);

  const allProviderPackages = getAllInstalledProviderPackages(
    packageJson,
    provider,
  );

  if (allProviderPackages.length > 0) {
    await uninstallPackages(allProviderPackages, provider.name, options);
  }

  const posthogPackages = new Set<string>();
  for (const pkg of allProviderPackages) {
    const posthogEquivalent = provider.getPostHogEquivalent(pkg.packageName);
    if (posthogEquivalent) {
      posthogPackages.add(posthogEquivalent);
    }
  }

  if (posthogPackages.size === 0) {
    posthogPackages.add('posthog-js');
  }

  let packageManagerUsed: PackageManager | undefined;
  for (const posthogPackage of posthogPackages) {
    const { packageManager } = await installPackage({
      packageName: posthogPackage,
      packageNameDisplayLabel: posthogPackage,
      alreadyInstalled: false,
      forceInstall: options.forceInstall,
      askBeforeUpdating: false,
      installDir: options.installDir,
      integration: framework as Integration,
    });
    packageManagerUsed = packageManager;
  }

  const migrationDocumentation = provider.getMigrationDocs({
    language: typeScriptDetected ? 'typescript' : 'javascript',
    envVarPrefix,
    framework,
  });

  const relevantFiles = await getRelevantFilesForMigration(options);

  clack.log.info(`Reviewing project files for ${provider.name} code...`);

  const filesToMigrate = await getFilesToMigrate({
    relevantFiles,
    documentation: migrationDocumentation,
    accessToken,
    cloudRegion,
    projectId,
    providerName: provider.name,
  });

  if (filesToMigrate.length === 0) {
    clack.log.warn(
      `No files with ${provider.name} code detected. The migration may already be complete.`,
    );
  } else {
    await migrateFiles({
      filesToMigrate,
      accessToken,
      documentation: migrationDocumentation,
      installDir: options.installDir,
      cloudRegion,
      projectId,
      providerName: provider.name,
    });
  }

  const { relativeEnvFilePath, addedEnvVariables } =
    await addOrUpdateEnvironmentVariablesStep({
      variables: {
        [envVarPrefix + 'POSTHOG_KEY']: projectApiKey,
        [envVarPrefix + 'POSTHOG_HOST']: host,
      },
      installDir: options.installDir,
      integration: framework as Integration,
    });

  const packageManagerForOutro =
    packageManagerUsed ?? (await getPackageManager(options));

  await runPrettierStep({
    installDir: options.installDir,
    integration: framework as Integration,
  });

  const addedEditorRules = await addEditorRulesStep({
    installDir: options.installDir,
    rulesName: 'react-rules.md',
    integration: framework as Integration,
  });

  const uploadedEnvVars = await uploadEnvironmentVariablesStep(
    {
      [envVarPrefix + 'POSTHOG_KEY']: projectApiKey,
      [envVarPrefix + 'POSTHOG_HOST']: host,
    },
    {
      integration: framework as Integration,
      options,
    },
  );

  await addMCPServerToClientsStep({
    cloudRegion,
    integration: framework as Integration,
  });

  const outroMessage = getMigrationOutroMessage({
    options,
    cloudRegion,
    provider,
    addedEditorRules,
    packageManager: packageManagerForOutro,
    envFileChanged: addedEnvVariables ? relativeEnvFilePath : undefined,
    uploadedEnvVars,
    migratedFilesCount: filesToMigrate.length,
  });

  clack.outro(outroMessage);

  await analytics.shutdown('success');
}

async function detectFramework(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<'react' | 'nextjs' | 'svelte' | 'astro' | 'react-native' | 'node'> {
  const packageJson = await getPackageDotJson(options);

  if (
    packageJson?.dependencies?.['next'] ||
    packageJson?.devDependencies?.['next']
  ) {
    return 'nextjs';
  }
  if (
    packageJson?.dependencies?.['react-native'] ||
    packageJson?.devDependencies?.['react-native']
  ) {
    return 'react-native';
  }
  if (
    packageJson?.dependencies?.['@sveltejs/kit'] ||
    packageJson?.devDependencies?.['@sveltejs/kit']
  ) {
    return 'svelte';
  }
  if (
    packageJson?.dependencies?.['astro'] ||
    packageJson?.devDependencies?.['astro']
  ) {
    return 'astro';
  }
  if (
    packageJson?.dependencies?.['react'] ||
    packageJson?.devDependencies?.['react']
  ) {
    return 'react';
  }
  return 'node';
}

async function uninstallPackages(
  packages: InstalledPackage[],
  providerName: string,
  options: Pick<WizardOptions, 'installDir'>,
): Promise<void> {
  const packageManager = await getPackageManager(options);

  const uninstallSpinner = clack.spinner();
  uninstallSpinner.start(
    `Removing ${providerName} packages: ${packages
      .map((p) => p.packageName)
      .join(', ')}`,
  );

  try {
    const packageNames = packages.map((p) => p.packageName).join(' ');
    const uninstallCommand =
      packageManager.name === 'yarn'
        ? `yarn remove ${packageNames}`
        : packageManager.name === 'pnpm'
        ? `pnpm remove ${packageNames}`
        : `npm uninstall ${packageNames}`;

    await new Promise<void>((resolve, reject) => {
      childProcess.exec(
        uninstallCommand,
        { cwd: options.installDir },
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        },
      );
    });

    uninstallSpinner.stop(
      `Removed ${providerName} packages: ${packages
        .map((p) => chalk.cyan(p.packageName))
        .join(', ')}`,
    );

    analytics.capture('wizard interaction', {
      action: 'uninstalled packages',
      packages: packages.map((p) => p.packageName),
      migration_source: providerName.toLowerCase(),
    });
  } catch (error) {
    uninstallSpinner.stop(`Failed to remove ${providerName} packages`);
    clack.log.warn(
      `Could not automatically remove ${providerName} packages. Please remove them manually.`,
    );
  }
}

async function getRelevantFilesForMigration(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<string[]> {
  const filterPatterns = ['**/*.{tsx,ts,jsx,js,mjs,cjs}'];
  const ignorePatterns = GLOBAL_IGNORE_PATTERN;

  const filteredFiles = await fg(filterPatterns, {
    cwd: options.installDir,
    ignore: ignorePatterns,
  });

  analytics.capture('wizard interaction', {
    action: 'detected relevant files for migration',
    number_of_files: filteredFiles.length,
  });

  return filteredFiles;
}

async function getFilesToMigrate({
  relevantFiles,
  documentation,
  accessToken,
  cloudRegion,
  projectId,
  providerName,
}: {
  relevantFiles: string[];
  documentation: string;
  accessToken: string;
  cloudRegion: CloudRegion;
  projectId: number;
  providerName: string;
}): Promise<string[]> {
  const filterFilesSpinner = clack.spinner();
  filterFilesSpinner.start(`Scanning for ${providerName} code...`);

  const filterFilesResponseSchema = z.object({
    files: z.array(z.string()),
  });

  const prompt = await migrationFilterFilesPromptTemplate.format({
    documentation,
    file_list: relevantFiles.join('\n'),
    source_sdk: providerName,
    integration_rules: '',
  });

  const filterFilesResponse = await query({
    message: prompt,
    schema: filterFilesResponseSchema,
    accessToken,
    region: cloudRegion,
    projectId,
  });

  const filesToMigrate = filterFilesResponse.files;

  filterFilesSpinner.stop(
    `Found ${filesToMigrate.length} files with ${providerName} code`,
  );

  analytics.capture('wizard interaction', {
    action: 'detected files to migrate',
    files: filesToMigrate,
    migration_source: providerName.toLowerCase(),
  });

  return filesToMigrate;
}

async function migrateFiles({
  filesToMigrate,
  accessToken,
  documentation,
  installDir,
  cloudRegion,
  projectId,
  providerName,
}: {
  filesToMigrate: string[];
  accessToken: string;
  documentation: string;
  installDir: string;
  cloudRegion: CloudRegion;
  projectId: number;
  providerName: string;
}): Promise<FileChange[]> {
  const changes: FileChange[] = [];

  for (const filePath of filesToMigrate) {
    const fileChangeSpinner = clack.spinner();

    analytics.capture('wizard interaction', {
      action: 'migrating file',
      file: filePath,
      migration_source: providerName.toLowerCase(),
    });

    try {
      let oldContent: string | undefined = undefined;
      try {
        oldContent = await fs.promises.readFile(
          path.join(installDir, filePath),
          'utf8',
        );
      } catch (readError: unknown) {
        if (
          readError instanceof Error &&
          (readError as NodeJS.ErrnoException).code !== 'ENOENT'
        ) {
          clack.log.warn(`Error reading file ${filePath}`);
          continue;
        }
      }

      if (!oldContent) {
        continue;
      }

      fileChangeSpinner.start(`Migrating ${filePath}`);

      const unchangedFiles = filesToMigrate.filter(
        (f) => !changes.some((change) => change.filePath === f),
      );

      const prompt = await migrationGenerateFileChangesPromptTemplate.format({
        file_content: oldContent,
        file_path: filePath,
        documentation,
        source_sdk: providerName,
        integration_rules: '',
        changed_files: changes
          .map((change) => `${change.filePath}\n${change.newContent}`)
          .join('\n'),
        unchanged_files: unchangedFiles.join('\n'),
      });

      const response = await query({
        message: prompt,
        schema: z.object({
          newContent: z.string(),
        }),
        accessToken,
        region: cloudRegion,
        projectId,
      });

      const newContent = response.newContent;

      if (newContent !== oldContent) {
        await updateFile({ filePath, oldContent, newContent }, { installDir });
        changes.push({ filePath, oldContent, newContent });
      }

      fileChangeSpinner.stop(`Migrated ${filePath}`);

      analytics.capture('wizard interaction', {
        action: 'migrated file',
        file: filePath,
        migration_source: providerName.toLowerCase(),
      });
    } catch (error) {
      fileChangeSpinner.stop(`Error migrating ${filePath}`);
      clack.log.warn(`Could not migrate ${filePath}. Please migrate manually.`);
    }
  }

  analytics.capture('wizard interaction', {
    action: 'completed migration',
    files: filesToMigrate,
    migration_source: providerName.toLowerCase(),
  });

  return changes;
}

function getMigrationOutroMessage({
  options: _options,
  cloudRegion,
  provider,
  addedEditorRules,
  packageManager: _packageManager,
  envFileChanged,
  uploadedEnvVars,
  migratedFilesCount,
}: MigrationOutroOptions): string {
  const cloudUrl =
    cloudRegion === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com';

  let message = chalk.green(`Migration from ${provider.name} complete! 🎉\n\n`);

  message += chalk.bold('What we did:\n');
  message += provider.defaultChanges;
  message += `\n• Migrated ${migratedFilesCount} file${
    migratedFilesCount !== 1 ? 's' : ''
  }`;

  if (envFileChanged) {
    message += `\n• Added environment variables to ${envFileChanged}`;
  }

  if (uploadedEnvVars.length > 0) {
    message += '\n• Uploaded environment variables to Vercel';
  }

  if (addedEditorRules) {
    message += '\n• Added PostHog editor rules';
  }

  message += '\n\n';
  message += chalk.bold('Next steps:\n');
  message += provider.nextSteps;

  message += `\n\n`;
  message += `View your data at: ${chalk.cyan(cloudUrl)}`;

  return message;
}

export async function checkAndOfferMigration(
  options: WizardOptions,
  providerId: string,
): Promise<boolean> {
  const provider = getMigrationProvider(providerId);
  if (!provider) return false;

  const packageJson = await getPackageDotJson(options);
  const installation = detectProviderInstallation(packageJson, provider);

  if (!installation) {
    return false;
  }

  clack.log.warn(
    `Detected ${provider.name} SDK: ${chalk.cyan(installation.packageName)}@${
      installation.version
    }`,
  );

  const shouldMigrate = await abortIfCancelled(
    clack.confirm({
      message: `Would you like to migrate from ${provider.name} to PostHog? This will replace ${provider.name} code with PostHog equivalents.`,
      initialValue: true,
    }),
  );

  analytics.capture('wizard interaction', {
    action: `offered ${providerId} migration`,
    accepted: shouldMigrate,
    package: installation.packageName,
  });

  return shouldMigrate;
}
