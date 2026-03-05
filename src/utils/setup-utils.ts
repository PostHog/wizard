import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { isAbsolute, join, relative } from 'node:path';

import chalk from 'chalk';
import { traceStep } from '../telemetry';
import { debug } from './debug';
import type { PackageDotJson } from './package-json';
import {
  type PackageManager,
  detectAllPackageManagers,
  NPM as npm,
} from './package-manager';
import type { CloudRegion, WizardOptions } from './types';
import { getPackageVersion } from './package-json';
import {
  DEFAULT_HOST_URL,
  DUMMY_PROJECT_API_KEY,
  ISSUES_URL,
} from '../lib/constants';
import { analytics } from './analytics';
import { getUI } from '../ui';
import {
  getCloudUrlFromRegion,
  getHostFromRegion,
  detectRegionFromToken,
} from './urls';
import { performOAuthFlow } from './oauth';
import { fetchUserData, fetchProjectData } from '../lib/api';
import { fulfillsVersionRange } from './semver';

interface ProjectData {
  projectApiKey: string;
  accessToken: string;
  host: string;
  distinctId: string;
  projectId: number;
}

export interface CliSetupConfig {
  filename: string;
  name: string;
  gitignore: boolean;

  likelyAlreadyHasAuthToken(contents: string): boolean;
  tokenContent(authToken: string): string;

  likelyAlreadyHasOrgAndProject(contents: string): boolean;
  orgAndProjContent(org: string, project: string): string;

  likelyAlreadyHasUrl?(contents: string): boolean;
  urlContent?(url: string): string;
}

export interface CliSetupConfigContent {
  authToken: string;
  org?: string;
  project?: string;
  url?: string;
}

export async function abort(message?: string, status?: number): Promise<never> {
  await analytics.shutdown('cancelled');

  getUI().outro(message ?? 'Wizard setup cancelled.');
  return process.exit(status ?? 1);
}

export function isInGitRepo() {
  try {
    childProcess.execSync('git rev-parse --is-inside-work-tree', {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

export function getUncommittedOrUntrackedFiles(): string[] {
  try {
    const gitStatus = childProcess
      .execSync('git status --porcelain=v1', {
        // we only care about stdout
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      .toString();

    const files = gitStatus
      .split(os.EOL)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((f) => `- ${f.split(/\s+/)[1]}`);

    return files;
  } catch {
    return [];
  }
}

export async function isReact19Installed({
  installDir,
}: Pick<WizardOptions, 'installDir'>): Promise<boolean> {
  try {
    const packageJson = await getPackageDotJson({ installDir });
    const reactVersion = getPackageVersion('react', packageJson);

    if (!reactVersion) {
      return false;
    }

    return fulfillsVersionRange({
      version: reactVersion,
      acceptableVersions: '>=19.0.0',
      canBeLatest: true,
    });
  } catch {
    return false;
  }
}

/**
 * Installs or updates a package with the user's package manager.
 *
 * IMPORTANT: This function modifies the `package.json`! Be sure to re-read
 * it if you make additional modifications to it after calling this function!
 */
export async function installPackage({
  packageName,
  alreadyInstalled,
  packageNameDisplayLabel,
  packageManager,
  forceInstall = false,
  integration,
  installDir,
}: {
  packageName: string;
  alreadyInstalled: boolean;
  packageNameDisplayLabel?: string;
  packageManager?: PackageManager;
  forceInstall?: boolean;
  integration?: string;
  installDir: string;
}): Promise<{ packageManager?: PackageManager }> {
  return traceStep('install-package', async () => {
    const sdkInstallSpinner = getUI().spinner();

    const pkgManager =
      packageManager || (await getPackageManager({ installDir }));

    const isReact19 = await isReact19Installed({ installDir });
    const legacyPeerDepsFlag =
      isReact19 && pkgManager.name === 'npm' ? '--legacy-peer-deps' : '';

    sdkInstallSpinner.start(
      `${alreadyInstalled ? 'Updating' : 'Installing'} ${chalk.bold.cyan(
        packageNameDisplayLabel ?? packageName,
      )} with ${chalk.bold(pkgManager.label)}.`,
    );

    try {
      await new Promise<void>((resolve, reject) => {
        childProcess.exec(
          `${pkgManager.installCommand} ${packageName} ${pkgManager.flags} ${
            forceInstall ? pkgManager.forceInstallFlag : ''
          } ${legacyPeerDepsFlag}`.trim(),
          { cwd: installDir },
          (err, stdout, stderr) => {
            if (err) {
              fs.writeFileSync(
                join(
                  process.cwd(),
                  `posthog-wizard-installation-error-${Date.now()}.log`,
                ),
                JSON.stringify({
                  stdout,
                  stderr,
                }),
                { encoding: 'utf8' },
              );

              reject(err);
            } else {
              resolve();
            }
          },
        );
      });
    } catch (e) {
      sdkInstallSpinner.stop('Installation failed.');
      getUI().log.error(
        `${chalk.red(
          'Encountered the following error during installation:',
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        )}\n\n${e}\n\n${chalk.dim(
          `The wizard has created a \`posthog-wizard-installation-error-*.log\` file. If you think this issue is caused by the PostHog wizard, create an issue on GitHub and include the log file's content:\n${ISSUES_URL}`,
        )}`,
      );
      await abort();
    }

    sdkInstallSpinner.stop(
      `${alreadyInstalled ? 'Updated' : 'Installed'} ${chalk.bold.cyan(
        packageNameDisplayLabel ?? packageName,
      )} with ${chalk.bold(pkgManager.label)}.`,
    );

    analytics.capture('wizard interaction', {
      action: 'package installed',
      package_name: packageName,
      package_manager: pkgManager.name,
      integration,
    });

    return { packageManager: pkgManager };
  });
}

export async function getPackageDotJson({
  installDir,
}: Pick<WizardOptions, 'installDir'>): Promise<PackageDotJson> {
  const packageJsonFileContents = await fs.promises
    .readFile(join(installDir, 'package.json'), 'utf8')
    .catch(() => {
      getUI().log.error(
        'Could not find package.json. Make sure to run the wizard in the root of your app!',
      );
      return abort();
    });

  let packageJson: PackageDotJson | undefined = undefined;

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    packageJson = JSON.parse(packageJsonFileContents);
  } catch {
    getUI().log.error(
      `Unable to parse your ${chalk.cyan(
        'package.json',
      )}. Make sure it has a valid format!`,
    );

    await abort();
  }

  return packageJson || {};
}

/**
 * Try to get package.json, returning null if it doesn't exist.
 * Use this for detection purposes where missing package.json is expected (e.g., Python projects).
 */
export async function tryGetPackageJson({
  installDir,
}: Pick<WizardOptions, 'installDir'>): Promise<PackageDotJson | null> {
  try {
    const packageJsonFileContents = await fs.promises.readFile(
      join(installDir, 'package.json'),
      'utf8',
    );
    return JSON.parse(packageJsonFileContents) as PackageDotJson;
  } catch {
    return null;
  }
}

export async function updatePackageDotJson(
  packageDotJson: PackageDotJson,
  { installDir }: Pick<WizardOptions, 'installDir'>,
): Promise<void> {
  try {
    await fs.promises.writeFile(
      join(installDir, 'package.json'),
      JSON.stringify(packageDotJson, null, 2),
      {
        encoding: 'utf8',
        flag: 'w',
      },
    );
  } catch {
    getUI().log.error(`Unable to update your ${chalk.cyan('package.json')}.`);

    await abort();
  }
}

/**
 * Detect and return the package manager. Pure — no prompts.
 * Falls back to first detected or npm if ambiguous.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function getPackageManager(
  options: Pick<WizardOptions, 'installDir'> & { ci?: boolean },
): Promise<PackageManager> {
  const detectedPackageManagers = detectAllPackageManagers({
    installDir: options.installDir,
  });

  if (detectedPackageManagers.length >= 1) {
    const selected = detectedPackageManagers[0];
    analytics.setTag('package-manager', selected.name);
    return selected;
  }

  // No package manager detected — default to npm
  analytics.setTag('package-manager', npm.name);
  return npm;
}

export function isUsingTypeScript({
  installDir,
}: Pick<WizardOptions, 'installDir'>) {
  try {
    return fs.existsSync(join(installDir, 'tsconfig.json'));
  } catch {
    return false;
  }
}

/**
 * Get project data for the wizard via OAuth or CI API key.
 */
export async function getOrAskForProjectData(
  _options: Pick<WizardOptions, 'signup' | 'ci' | 'apiKey' | 'projectId'>,
): Promise<{
  host: string;
  projectApiKey: string;
  accessToken: string;
  projectId: number;
  cloudRegion: CloudRegion;
}> {
  // CI mode: bypass OAuth, use personal API key for LLM gateway
  if (_options.ci && _options.apiKey) {
    getUI().log.info('Using provided API key (CI mode - OAuth bypassed)');

    const cloudRegion = await detectRegionFromToken(_options.apiKey);
    const host = getHostFromRegion(cloudRegion);
    const cloudUrl = getCloudUrlFromRegion(cloudRegion);

    const projectData =
      _options.projectId != null
        ? await fetchProjectDataById(
            _options.apiKey,
            _options.projectId,
            cloudUrl,
          )
        : await fetchProjectDataWithApiKey(_options.apiKey, cloudUrl);

    return {
      host,
      projectApiKey: projectData.api_token,
      accessToken: _options.apiKey,
      projectId: projectData.id,
      cloudRegion,
    };
  }

  const { host, projectApiKey, accessToken, projectId, cloudRegion } =
    await traceStep('login', () =>
      askForWizardLogin({
        signup: _options.signup,
      }),
    );

  if (!projectApiKey) {
    const cloudUrl = getCloudUrlFromRegion(cloudRegion);
    getUI().log.error(`Didn't receive a project token. This shouldn't happen :(

Please let us know if you think this is a bug in the wizard:
${chalk.cyan(ISSUES_URL)}`);

    getUI().log
      .info(`In the meantime, we'll add a dummy project token (${chalk.cyan(
      `"${DUMMY_PROJECT_API_KEY}"`,
    )}) for you to replace later.
You can find your project token here:
${chalk.cyan(`${cloudUrl}/settings/project#variables`)}`);
  }

  return {
    accessToken,
    host: host || DEFAULT_HOST_URL,
    projectApiKey: projectApiKey || DUMMY_PROJECT_API_KEY,
    projectId,
    cloudRegion,
  };
}

async function fetchProjectDataWithApiKey(
  apiKey: string,
  cloudUrl: string,
): Promise<{ api_token: string; id: number }> {
  const userData = await fetchUserData(apiKey, cloudUrl);
  const projectId = userData.team?.id;

  if (!projectId) {
    throw new Error(
      'Could not determine project ID from API key. Please ensure your API key has access to a project in this cloud region.',
    );
  }

  const projectData = await fetchProjectData(apiKey, projectId, cloudUrl);
  return {
    api_token: projectData.api_token,
    id: projectId,
  };
}

async function fetchProjectDataById(
  apiKey: string,
  projectId: number,
  cloudUrl: string,
): Promise<{ api_token: string; id: number }> {
  const projectData = await fetchProjectData(apiKey, projectId, cloudUrl);
  return {
    api_token: projectData.api_token,
    id: projectId,
  };
}

async function askForWizardLogin(options: {
  signup: boolean;
}): Promise<ProjectData & { cloudRegion: CloudRegion }> {
  const tokenResponse = await performOAuthFlow({
    scopes: [
      'user:read',
      'project:read',
      'introspection',
      'llm_gateway:read',
      'dashboard:write',
      'insight:write',
      'query:read',
    ],
    signup: options.signup,
  });

  const projectId = tokenResponse.scoped_teams?.[0];

  if (projectId === undefined) {
    const error = new Error(
      'No project access granted. Please authorize with project-level access.',
    );
    analytics.captureException(error, {
      step: 'wizard_login',
      has_scoped_teams: !!tokenResponse.scoped_teams,
    });
    getUI().log.error(error.message);
    await abort();
  }

  const cloudRegion = await detectRegionFromToken(tokenResponse.access_token);
  const cloudUrl = getCloudUrlFromRegion(cloudRegion);
  const host = getHostFromRegion(cloudRegion);

  const projectData = await fetchProjectData(
    tokenResponse.access_token,
    projectId!,
    cloudUrl,
  );
  const userData = await fetchUserData(tokenResponse.access_token, cloudUrl);

  const data = {
    accessToken: tokenResponse.access_token,
    projectApiKey: projectData.api_token,
    host,
    distinctId: userData.distinct_id,
    projectId: projectId!,
    cloudRegion,
  };

  getUI().log.success(
    `Login complete. ${options.signup ? 'Welcome to PostHog!' : ''}`,
  );
  analytics.setTag('opened-wizard-link', true);
  analytics.setDistinctId(data.distinctId);

  return data;
}

/**
 * Creates a new config file with the given filepath and codeSnippet.
 */
export async function createNewConfigFile(
  filepath: string,
  codeSnippet: string,
  { installDir }: Pick<WizardOptions, 'installDir'>,
  moreInformation?: string,
): Promise<boolean> {
  if (!isAbsolute(filepath)) {
    debug(`createNewConfigFile: filepath is not absolute: ${filepath}`);
    return false;
  }

  const prettyFilename = chalk.cyan(relative(installDir, filepath));

  try {
    await fs.promises.writeFile(filepath, codeSnippet);

    getUI().log.success(`Added new ${prettyFilename} file.`);

    if (moreInformation) {
      getUI().log.info(chalk.gray(moreInformation));
    }

    return true;
  } catch (e) {
    debug(e);
    getUI().log.warn(
      `Could not create a new ${prettyFilename} file. Please create one manually and follow the instructions below.`,
    );
  }

  return false;
}
