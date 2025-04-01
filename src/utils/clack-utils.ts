import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { basename, isAbsolute, join, relative } from 'node:path';
import { setInterval } from 'node:timers';
import { URL } from 'node:url';
import axios from 'axios';
import chalk from 'chalk';
import opn from 'opn';
import { traceStep } from '../telemetry';
import { debug } from './debug';
import { type PackageDotJson, hasPackageInstalled } from './package-json';
import {
  type PackageManager,
  detectPackageManger,
  packageManagers,
} from './package-manager';
import { fulfillsVersionRange } from './semver';
import type { CloudRegion, Feature, WizardOptions } from './types';
import {
  DEFAULT_HOST_URL,
  DUMMY_PROJECT_API_KEY,
  ISSUES_URL,
  type Integration,
} from '../lib/constants';
import { analytics } from './analytics';
import clack from './clack';
import { getCloudUrlFromRegion } from './urls';

interface ProjectData {
  projectApiKey: string;
  host: string;
  wizardHash: string;
  distinctId: string;
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

  clack.outro(message ?? 'Wizard setup cancelled.');
  return process.exit(status ?? 1);
}

export async function abortIfCancelled<T>(
  input: T | Promise<T>,
): Promise<Exclude<T, symbol>> {
  await analytics.shutdown('cancelled');

  if (clack.isCancel(await input)) {
    clack.cancel('Wizard setup cancelled.');
    process.exit(0);
  } else {
    return input as Exclude<T, symbol>;
  }
}

export function printWelcome(options: {
  wizardName: string;
  message?: string;
}): void {
  // eslint-disable-next-line no-console
  console.log('');
  clack.intro(chalk.inverse(` ${options.wizardName} `));

  const welcomeText =
    options.message ||
    `The ${options.wizardName} will help you set up PostHog for your application.\nThank you for using PostHog :)`;

  clack.note(welcomeText);
}

export async function confirmContinueIfNoOrDirtyGitRepo(
  options: Pick<WizardOptions, 'default'>,
): Promise<void> {
  return traceStep('check-git-status', async () => {
    if (!isInGitRepo()) {
      const continueWithoutGit = options.default
        ? true
        : await abortIfCancelled(
          clack.confirm({
            message:
              'You are not inside a git repository. The wizard will create and update files. Do you want to continue anyway?',
          }),
        );

      analytics.setTag('continue-without-git', continueWithoutGit);

      if (!continueWithoutGit) {
        await abort(undefined, 0);
      }
      // return early to avoid checking for uncommitted files
      return;
    }

    const uncommittedOrUntrackedFiles = getUncommittedOrUntrackedFiles();
    if (uncommittedOrUntrackedFiles.length) {
      clack.log.warn(
        `You have uncommitted or untracked files in your repo:

${uncommittedOrUntrackedFiles.join('\n')}

The wizard will create and update files.`,
      );
      const continueWithDirtyRepo = options.default
        ? true
        : await abortIfCancelled(
          clack.confirm({
            message: 'Do you want to continue anyway?',
          }),
        );

      analytics.setTag('continue-with-dirty-repo', continueWithDirtyRepo);

      if (!continueWithDirtyRepo) {
        await abort(undefined, 0);
      }
    }
  });
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

export async function askForItemSelection(
  items: string[],
  message: string,
): Promise<{ value: string; index: number }> {
  const selection: { value: string; index: number } | symbol =
    await abortIfCancelled(
      clack.select({
        maxItems: 12,
        message: message,
        options: items.map((item, index) => {
          return {
            value: { value: item, index: index },
            label: item,
          };
        }),
      }),
    );

  return selection;
}

export async function confirmContinueIfPackageVersionNotSupported({
  packageId,
  packageName,
  packageVersion,
  acceptableVersions,
  note,
}: {
  packageId: string;
  packageName: string;
  packageVersion: string;
  acceptableVersions: string;
  note?: string;
}): Promise<void> {
  return traceStep(`check-package-version`, async () => {
    analytics.setTag(`${packageName.toLowerCase()}-version`, packageVersion);
    const isSupportedVersion = fulfillsVersionRange({
      acceptableVersions,
      version: packageVersion,
      canBeLatest: true,
    });

    if (isSupportedVersion) {
      analytics.setTag(`${packageName.toLowerCase()}-supported`, true);
      return;
    }

    clack.log.warn(
      `You have an unsupported version of ${packageName} installed:

  ${packageId}@${packageVersion}`,
    );

    clack.note(
      note ??
      `Please upgrade to ${acceptableVersions} if you wish to use the PostHog Wizard.`,
    );
    const continueWithUnsupportedVersion = await abortIfCancelled(
      clack.confirm({
        message: 'Do you want to continue anyway?',
      }),
    );
    analytics.setTag(
      `${packageName.toLowerCase()}-continue-with-unsupported-version`,
      continueWithUnsupportedVersion,
    );

    if (!continueWithUnsupportedVersion) {
      await abort(undefined, 0);
    }
  });
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
  askBeforeUpdating = true,
  packageNameDisplayLabel,
  packageManager,
  forceInstall = false,
  integration,
  installDir,
}: {
  /** The string that is passed to the package manager CLI as identifier to install (e.g. `posthog-js`, or `posthog-js@^1.100.0`) */
  packageName: string;
  alreadyInstalled: boolean;
  askBeforeUpdating?: boolean;
  /** Overrides what is shown in the installation logs in place of the `packageName` option. Useful if the `packageName` is ugly */
  packageNameDisplayLabel?: string;
  packageManager?: PackageManager;
  /** Add force install flag to command to skip install precondition fails */
  forceInstall?: boolean;
  /** The integration that is being used */
  integration?: string;
  /** The directory to install the package in */
  installDir: string;
}): Promise<{ packageManager?: PackageManager }> {
  return traceStep('install-package', async () => {
    if (alreadyInstalled && askBeforeUpdating) {
      const shouldUpdatePackage = await abortIfCancelled(
        clack.confirm({
          message: `The ${chalk.bold.cyan(
            packageNameDisplayLabel ?? packageName,
          )} package is already installed. Do you want to update it to the latest version?`,
        }),
      );

      if (!shouldUpdatePackage) {
        return {};
      }
    }

    const sdkInstallSpinner = clack.spinner();

    const pkgManager =
      packageManager || (await getPackageManager({ installDir }));

    sdkInstallSpinner.start(
      `${alreadyInstalled ? 'Updating' : 'Installing'} ${chalk.bold.cyan(
        packageNameDisplayLabel ?? packageName,
      )} with ${chalk.bold(pkgManager.label)}.`,
    );

    try {
      await new Promise<void>((resolve, reject) => {
        childProcess.exec(
          `${pkgManager.installCommand} ${packageName} ${pkgManager.flags} ${forceInstall ? pkgManager.forceInstallFlag : ''
          }`,
          { cwd: installDir },
          (err, stdout, stderr) => {
            if (err) {
              // Write a log file so we can better troubleshoot issues
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
      clack.log.error(
        `${chalk.red(
          'Encountered the following error during installation:',
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        )}\n\n${e}\n\n${chalk.dim(
          `The wizard has created a \`posthog-wizard-installation-error-*.log\` file. If you think this issue is caused by the PostHog Wizard, create an issue on GitHub and include the log file's content:\n${ISSUES_URL}`,
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

export async function runPrettierIfInstalled({
  installDir,
  integration,
}: Pick<WizardOptions, 'installDir'> & {
  integration: Integration;
}): Promise<void> {
  return traceStep('run-prettier', async () => {
    if (!isInGitRepo()) {
      // We only run formatting on changed files. If we're not in a git repo, we can't find
      // changed files. So let's early-return without showing any formatting-related messages.
      return;
    }

    const changedOrUntrackedFiles = getUncommittedOrUntrackedFiles()
      .map((filename) => {
        return filename.startsWith('- ') ? filename.slice(2) : filename;
      })
      .join(' ');

    if (!changedOrUntrackedFiles.length) {
      // Likewise, if we can't find changed or untracked files, there's no point in running Prettier.
      return;
    }

    const packageJson = await getPackageDotJson({ installDir });
    const prettierInstalled = hasPackageInstalled('prettier', packageJson);

    analytics.setTag('prettier-installed', prettierInstalled);

    if (!prettierInstalled) {
      return;
    }

    const prettierSpinner = clack.spinner();
    prettierSpinner.start('Running Prettier on your files.');

    try {
      await new Promise<void>((resolve, reject) => {
        childProcess.exec(
          `npx prettier --ignore-unknown --write ${changedOrUntrackedFiles}`,
          (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          },
        );
      });
    } catch (e) {
      prettierSpinner.stop('Prettier failed to run.');
      clack.log.warn(
        'Prettier failed to run. There may be formatting issues in your updated files.',
      );
      return;
    }

    prettierSpinner.stop('Prettier has formatted your files.');

    analytics.capture('wizard interaction', {
      action: 'ran prettier',
      integration,
    });
  });
}

/**
 * Checks if @param packageId is listed as a dependency in @param packageJson.
 * If not, it will ask users if they want to continue without the package.
 *
 * Use this function to check if e.g. a the framework of the SDK is installed
 *
 * @param packageJson the package.json object
 * @param packageId the npm name of the package
 * @param packageName a human readable name of the package
 */
export async function ensurePackageIsInstalled(
  packageJson: PackageDotJson,
  packageId: string,
  packageName: string,
): Promise<void> {
  return traceStep('ensure-package-installed', async () => {
    const installed = hasPackageInstalled(packageId, packageJson);

    analytics.setTag(`${packageName.toLowerCase()}-installed`, installed);

    if (!installed) {
      analytics.setTag(`${packageName.toLowerCase()}-installed`, false);
      const continueWithoutPackage = await abortIfCancelled(
        clack.confirm({
          message: `${packageName} does not seem to be installed. Do you still want to continue?`,
          initialValue: false,
        }),
      );

      if (!continueWithoutPackage) {
        await abort(undefined, 0);
      }
    }
  });
}

export async function getPackageDotJson({
  installDir,
}: Pick<WizardOptions, 'installDir'>): Promise<PackageDotJson> {
  const packageJsonFileContents = await fs.promises
    .readFile(join(installDir, 'package.json'), 'utf8')
    .catch(() => {
      clack.log.error(
        'Could not find package.json. Make sure to run the wizard in the root of your app!',
      );
      return abort();
    });

  let packageJson: PackageDotJson | undefined = undefined;

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    packageJson = JSON.parse(packageJsonFileContents);
  } catch {
    clack.log.error(
      `Unable to parse your ${chalk.cyan(
        'package.json',
      )}. Make sure it has a valid format!`,
    );

    await abort();
  }

  return packageJson || {};
}

export async function updatePackageDotJson(
  packageDotJson: PackageDotJson,
  { installDir }: Pick<WizardOptions, 'installDir'>,
): Promise<void> {
  try {
    await fs.promises.writeFile(
      join(installDir, 'package.json'),
      // TODO: maybe figure out the original indentation
      JSON.stringify(packageDotJson, null, 2),
      {
        encoding: 'utf8',
        flag: 'w',
      },
    );
  } catch {
    clack.log.error(`Unable to update your ${chalk.cyan('package.json')}.`);

    await abort();
  }
}

export async function getPackageManager({
  installDir,
}: Pick<WizardOptions, 'installDir'>): Promise<PackageManager> {
  const detectedPackageManager = detectPackageManger({ installDir });

  if (detectedPackageManager) {
    return detectedPackageManager;
  }

  const selectedPackageManager: PackageManager | symbol =
    await abortIfCancelled(
      clack.select({
        message: 'Please select your package manager.',
        options: packageManagers.map((packageManager) => ({
          value: packageManager,
          label: packageManager.label,
        })),
      }),
    );

  analytics.setTag('package-manager', selectedPackageManager.name);

  return selectedPackageManager;
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
 *
 * Use this function to get project data for the wizard.
 *
 * @param options wizard options
 * @returns project data (token, url)
 */
export async function getOrAskForProjectData(
  _options: WizardOptions & {
    cloudRegion: CloudRegion;
  },
): Promise<{
  wizardHash: string;
  host: string;
  projectApiKey: string;
}> {
  const cloudUrl = getCloudUrlFromRegion(_options.cloudRegion);
  const { host, projectApiKey, wizardHash } = await traceStep('login', () =>
    askForWizardLogin({
      url: cloudUrl,
    }),
  );

  if (!projectApiKey) {
    clack.log.error(`Didn't receive a project API key. This shouldn't happen :(

Please let us know if you think this is a bug in the wizard:
${chalk.cyan(ISSUES_URL)}`);

    clack.log
      .info(`In the meantime, we'll add a dummy project API key (${chalk.cyan(
        `"${DUMMY_PROJECT_API_KEY}"`,
      )}) for you to replace later.
You can find your Project API key here:
${chalk.cyan(`${cloudUrl}/settings/project#variables`)}`);
  }

  return {
    wizardHash,
    host: host || DEFAULT_HOST_URL,
    projectApiKey: projectApiKey || DUMMY_PROJECT_API_KEY,
  };
}

async function askForWizardLogin(options: {
  url: string;
}): Promise<ProjectData> {
  let wizardHash: string;

  try {
    wizardHash = (
      await axios.post<{ hash: string }>(`${options.url}/api/wizard/initialize`)
    ).data.hash;
  } catch (e: unknown) {
    clack.log.error('Loading wizard failed.');
    clack.log.info(JSON.stringify(e, null, 2));
    await abort(
      chalk.red(
        `Please try again in a few minutes and let us know if this issue persists: ${ISSUES_URL}`,
      ),
    );
  }

  const loginUrl = new URL(`${options.url}/wizard?hash=${wizardHash!}`);

  const urlToOpen = loginUrl.toString();

  clack.log.info(
    `${chalk.bold(
      `If the browser window didn't open automatically, please open the following link to login into PostHog:`,
    )}\n\n${chalk.cyan(urlToOpen)}`,
  );

  opn(urlToOpen, { wait: false }).catch(() => {
    // opn throws in environments that don't have a browser (e.g. remote shells) so we just noop here
  });

  const loginSpinner = clack.spinner();

  loginSpinner.start('Waiting for you to log in using the link above');

  const data = await new Promise<ProjectData>((resolve) => {
    const pollingInterval = setInterval(() => {
      axios
        .get<{
          project_api_key: string;
          host: string;
          user_distinct_id: string;
        }>(`${options.url}/api/wizard/data`, {
          headers: {
            'Accept-Encoding': 'deflate',
            'X-PostHog-Wizard-Hash': wizardHash,
          },
        })
        .then((result) => {
          const data: ProjectData = {
            wizardHash,
            projectApiKey: result.data.project_api_key,
            host: result.data.host,
            distinctId: result.data.user_distinct_id,
          };

          resolve(data);
          clearTimeout(timeout);
          clearInterval(pollingInterval);
        })
        .catch(() => {
          // noop - just try again
        });
    }, 500);

    const timeout = setTimeout(() => {
      clearInterval(pollingInterval);
      loginSpinner.stop(
        'Login timed out. No worries - it happens to the best of us.',
      );

      analytics.setTag('opened-wizard-link', false);
      void abort('Please restart the Wizard and log in to complete the setup.');
    }, 180_000);
  });

  loginSpinner.stop('Login complete.');
  analytics.setTag('opened-wizard-link', true);
  analytics.setDistinctId(data.distinctId);

  return data;
}

/**
 * Asks users if they have a config file for @param tool (e.g. Vite).
 * If yes, asks users to specify the path to their config file.
 *
 * Use this helper function as a fallback mechanism if the lookup for
 * a config file with its most usual location/name fails.
 *
 * @param toolName Name of the tool for which we're looking for the config file
 * @param configFileName Name of the most common config file name (e.g. vite.config.js)
 *
 * @returns a user path to the config file or undefined if the user doesn't have a config file
 */
export async function askForToolConfigPath(
  toolName: string,
  configFileName: string,
): Promise<string | undefined> {
  const hasConfig = await abortIfCancelled(
    clack.confirm({
      message: `Do you have a ${toolName} config file (e.g. ${chalk.cyan(
        configFileName,
      )})?`,
      initialValue: true,
    }),
  );

  if (!hasConfig) {
    return undefined;
  }

  return await abortIfCancelled(
    clack.text({
      message: `Please enter the path to your ${toolName} config file:`,
      placeholder: join('.', configFileName),
      validate: (value) => {
        if (!value) {
          return 'Please enter a path.';
        }

        try {
          fs.accessSync(value);
        } catch {
          return 'Could not access the file at this path.';
        }
      },
    }),
  );
}

/**
 * Prints copy/paste-able instructions to the console.
 * Afterwards asks the user if they added the code snippet to their file.
 *
 * While there's no point in providing a "no" answer here, it gives users time to fulfill the
 * task before the wizard continues with additional steps.
 *
 * Use this function if you want to show users instructions on how to add/modify
 * code in their file. This is helpful if automatic insertion failed or is not possible/feasible.
 *
 * @param filename the name of the file to which the code snippet should be applied.
 * If a path is provided, only the filename will be used.
 *
 * @param codeSnippet the snippet to be printed. Use {@link makeCodeSnippet}  to create the
 * diff-like format for visually highlighting unchanged or modified lines of code.
 *
 * @param hint (optional) a hint to be printed after the main instruction to add
 * the code from @param codeSnippet to their @param filename.
 *
 * TODO: refactor copy paste instructions across different wizards to use this function.
 *       this might require adding a custom message parameter to the function
 */
export async function showCopyPasteInstructions(
  filename: string,
  codeSnippet: string,
  hint?: string,
): Promise<void> {
  clack.log.step(
    `Add the following code to your ${chalk.cyan(basename(filename))} file:${hint ? chalk.dim(` (${chalk.dim(hint)})`) : ''
    }`,
  );

  // Padding the code snippet to be printed with a \n at the beginning and end
  // This makes it easier to distinguish the snippet from the rest of the output
  // Intentionally logging directly to console here so that the code can be copied/pasted directly
  // eslint-disable-next-line no-console
  console.log(`\n${codeSnippet}\n`);

  await abortIfCancelled(
    clack.select({
      message: 'Did you apply the snippet above?',
      options: [{ label: 'Yes, continue!', value: true }],
      initialValue: true,
    }),
  );
}

/**
 * Callback that exposes formatting helpers for a code snippet.
 * @param unchanged - Formats text as old code.
 * @param plus - Formats text as new code.
 * @param minus - Formats text as removed code.
 */
type CodeSnippetFormatter = (
  unchanged: (txt: string) => string,
  plus: (txt: string) => string,
  minus: (txt: string) => string,
) => string;

/**
 * Crafts a code snippet that can be used to e.g.
 * - print copy/paste instructions to the console
 * - create a new config file.
 *
 * @param colors set this to true if you want the final snippet to be colored.
 * This is useful for printing the snippet to the console as part of copy/paste instructions.
 *
 * @param callback the callback that returns the formatted code snippet.
 * It exposes takes the helper functions for marking code as unchanged, new or removed.
 * These functions no-op if no special formatting should be applied
 * and otherwise apply the appropriate formatting/coloring.
 * (@see {@link CodeSnippetFormatter})
 *
 * @see {@link showCopyPasteInstructions} for the helper with which to display the snippet in the console.
 *
 * @returns a string containing the final, formatted code snippet.
 */
export function makeCodeSnippet(
  colors: boolean,
  callback: CodeSnippetFormatter,
): string {
  const unchanged = (txt: string) => (colors ? chalk.grey(txt) : txt);
  const plus = (txt: string) => (colors ? chalk.greenBright(txt) : txt);
  const minus = (txt: string) => (colors ? chalk.redBright(txt) : txt);

  return callback(unchanged, plus, minus);
}

/**
 * Creates a new config file with the given @param filepath and @param codeSnippet.
 *
 * Use this function to create a new config file for users. This is useful
 * when users answered that they don't yet have a config file for a tool.
 *
 * (This doesn't mean that they don't yet have some other way of configuring
 * their tool but we can leave it up to them to figure out how to merge configs
 * here.)
 *
 * @param filepath absolute path to the new config file
 * @param codeSnippet the snippet to be inserted into the file
 * @param moreInformation (optional) the message to be printed after the file was created
 * For example, this can be a link to more information about configuring the tool.
 *
 * @returns true on success, false otherwise
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

    clack.log.success(`Added new ${prettyFilename} file.`);

    if (moreInformation) {
      clack.log.info(chalk.gray(moreInformation));
    }

    return true;
  } catch (e) {
    debug(e);
    clack.log.warn(
      `Could not create a new ${prettyFilename} file. Please create one manually and follow the instructions below.`,
    );
  }

  return false;
}

export async function featureSelectionPrompt<F extends ReadonlyArray<Feature>>(
  features: F,
): Promise<{ [key in F[number]['id']]: boolean }> {
  return traceStep('feature-selection', async () => {
    const selectedFeatures: Record<string, boolean> = {};

    for (const feature of features) {
      const selected = await abortIfCancelled(
        clack.select({
          message: feature.prompt,
          initialValue: true,
          options: [
            {
              value: true,
              label: 'Yes',
              hint: feature.enabledHint,
            },
            {
              value: false,
              label: 'No',
              hint: feature.disabledHint,
            },
          ],
        }),
      );

      selectedFeatures[feature.id] = selected;
    }

    return selectedFeatures as { [key in F[number]['id']]: boolean };
  });
}

export async function askShouldInstallPackage(
  pkgName: string,
): Promise<boolean> {
  return traceStep(`ask-install-package`, () =>
    abortIfCancelled(
      clack.confirm({
        message: `Do you want to install ${chalk.cyan(pkgName)}?`,
      }),
    ),
  );
}

export async function askShouldAddPackageOverride(
  pkgName: string,
  pkgVersion: string,
): Promise<boolean> {
  return traceStep(`ask-add-package-override`, () =>
    abortIfCancelled(
      clack.confirm({
        message: `Do you want to add an override for ${chalk.cyan(
          pkgName,
        )} version ${chalk.cyan(pkgVersion)}?`,
      }),
    ),
  );
}

export async function askForAIConsent(options: Pick<WizardOptions, 'default'>) {
  return await traceStep('ask-for-ai-consent', async () => {
    const aiConsent = options.default
      ? true
      : await abortIfCancelled(
        clack.select({
          message: 'Use AI to setup PostHog automatically? ✨',
          options: [
            {
              label: 'Yes',
              value: true,
              hint: 'We will use AI to help you setup PostHog quickly',
            },
            {
              label: 'No',
              value: false,
              hint: 'Continue without AI assistance',
            },
          ],
          initialValue: true,
        }),
      );

    return aiConsent;
  });
}

export async function askForCloudRegion(): Promise<CloudRegion> {
  return await traceStep('ask-for-cloud-region', async () => {
    const cloudRegion: CloudRegion = await abortIfCancelled(
      clack.select({
        message: 'Select your cloud region',
        options: [
          {
            label: 'US 🇺🇸',
            value: 'us',
          },
          {
            label: 'EU 🇪🇺',
            value: 'eu',
          },
        ],
      }),
    );

    return cloudRegion;
  });
}

export const PR_CONFIG = {
  defaultBranchName: 'posthog-integration',
  defaultTitle: 'Add PostHog Integration',
  defaultBody: 'This PR adds the PostHog integration.',
};

async function getCurrentBranch(installDir: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    childProcess.exec(
      `git rev-parse --abbrev-ref HEAD`,
      { cwd: installDir },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`Failed to detect current branch: ${stderr}`));
        } else {
          resolve(stdout.trim());
        }
      },
    );
  });
}

interface CreatePROptions {
  title?: string;
  body?: string;
  installDir: string;
}

export async function createPRFromNewBranch({
  title = PR_CONFIG.defaultTitle,
  body = PR_CONFIG.defaultBody,
  installDir,
}: CreatePROptions): Promise<void> {
  return traceStep('create-pr', async () => {
    if (!isInGitRepo()) {
      clack.log.warn('Not in a git repository. Cannot create a pull request.');
      return;
    }

    let baseBranch: string;
    try {
      baseBranch = await getCurrentBranch(installDir);
    } catch (error: any) {
      clack.log.error(error.message);
      return;
    }

    // if (baseBranch !== 'main') {
    //   clack.log.info(
    //     `Current branch is "${baseBranch}". Skipping PR creation since we're not on "main".`,
    //   );
    //   return;
    // }

    const newBranch = PR_CONFIG.defaultBranchName;
    try {
      await new Promise<void>((resolve, reject) => {
        childProcess.exec(
          `git rev-parse --verify ${newBranch}`,
          { cwd: installDir },
          (err) => {
            if (!err) {
              reject(
                new Error(
                  `Branch '${newBranch}' already exists. Please delete or rename it before creating a new PR.`,
                ),
              );
            } else {
              resolve();
            }
          },
        );
      });
    } catch (branchError: any) {
      clack.log.error(branchError.message);
      return;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        childProcess.exec(
          `git checkout -b ${newBranch}`,
          { cwd: installDir },
          (err, stdout, stderr) => {
            if (err) {
              reject(
                new Error(`Failed to create branch '${newBranch}': ${stderr}`),
              );
            } else {
              resolve();
            }
          },
        );
      });
    } catch (createBranchError: any) {
      clack.log.error(createBranchError.message);
      return;
    }

    // Stage and commit changes
    const commitSpinner = clack.spinner();
    commitSpinner.start('Staging and committing changes...');
    try {
      await new Promise<void>((resolve, reject) => {
        childProcess.exec(
          `git add . && git commit -m "${title}"`,
          { cwd: installDir },
          (err, stdout, stderr) => {
            if (err) {
              reject(new Error(`Failed to commit changes: ${stderr}`));
            } else {
              resolve();
            }
          },
        );
      });
    } catch (commitError: any) {
      commitSpinner.stop('Failed to commit changes.');
      clack.log.warn(commitError.message);
      return;
    }
    commitSpinner.stop('Changes committed successfully.');

    // Push the branch to remote
    const pushSpinner = clack.spinner();
    pushSpinner.start('Pushing branch to remote...');
    try {
      await new Promise<void>((resolve, reject) => {
        childProcess.exec(
          `git push -u origin ${newBranch}`,
          { cwd: installDir },
          (err, _stdout, stderr) => {
            if (err) {
              reject(new Error(`Failed to push branch: ${stderr}`));
            } else {
              resolve();
            }
          },
        );
      });
    } catch (pushError: any) {
      pushSpinner.stop('Failed to push branch.');
      clack.log.warn(pushError.message);
      return;
    }
    pushSpinner.stop('Branch pushed successfully.');

    const prSpinner = clack.spinner();
    prSpinner.start(
      `Creating a PR on branch '${newBranch}' with base '${baseBranch}'...`,
    );
    try {
      let prUrl = '';
      await new Promise<void>((resolve, reject) => {
        childProcess.exec(
          `gh pr create --base ${baseBranch} --head ${newBranch} --title "${title}" --body "${body}" --json url`,
          { cwd: installDir },
          (err, stdout, stderr) => {
            if (err) {
              reject(new Error(`Failed to create PR: ${stderr}`));
            } else {
              try {
                const result = JSON.parse(stdout);
                prUrl = result.url;
                resolve();
              } catch (parseError) {
                reject(new Error('Failed to parse PR URL from response'));
              }
            }
          },
        );
      });
      prSpinner.stop(
        `Successfully created PR! 🎉\n\nReview your changes here: ${chalk.cyan(
          prUrl,
        )}`,
      );
    } catch (prError: any) {
      prSpinner.stop(`Failed to create PR on branch '${newBranch}'.`);
      clack.log.warn(prError.message);
      return;
    }

    analytics.capture('wizard interaction', {
      action: 'created pr',
      branch: newBranch,
      base_branch: baseBranch,
    });
  });
}
