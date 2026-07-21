import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { basename, isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';

import { withProgress } from '../telemetry';
import { debug, logToFile } from './debug';
import type { PackageJson } from './package-json';
import {
  type PackageManager,
  detectAllPackageManagers,
  NPM as npm,
} from './package-manager';
import type { CloudRegion, WizardRunOptions } from './types';
import { getDeclaredVersion } from './package-json';
import { DUMMY_PROJECT_API_KEY, ISSUES_URL } from '@lib/constants';
import { getOAuthScopesForProgram } from '@lib/oauth/program-scopes';
import type { ProgramId } from '@lib/programs/program-registry';
import { analytics } from './analytics';
import { getUI } from '@ui';
import { HostResolution } from '@lib/host-resolution';
import { assertWizardCompletionScope, performOAuthFlow } from './oauth';
import { resolveGrantedProject } from './project-resolution';
import { provisionNewAccount } from './provisioning';
import {
  fetchUserData,
  fetchProjectData,
  type ApiUser,
  type ApiProject,
} from '@lib/api';
import { versionSatisfiesRange } from './semver';
import { wizardAbort } from './wizard-abort';

interface ProjectData {
  projectApiKey: string;
  accessToken: string;
  host: HostResolution;
  distinctId: string;
  projectId: number;
  /**
   * Optional `role_at_organization` from `/api/users/@me/`. Drives the
   * role-tailored prompt suggestions on the McpSuggestedPromptsScreen. Null
   * for signup flows (no role picked yet) and older accounts.
   */
  roleAtOrganization?: string | null;
  /**
   * Full user payload from `/api/users/@me/`. Carried through so
   * `getOrAskForProjectData` can forward it to the session as
   * `session.apiUser`. Null when the request failed or the CI key
   * lacked permissions.
   */
  user?: ApiUser | null;
  /**
   * Full project payload from `/api/projects/:id/`. Carries the team's
   * product opt-ins (replay, exception autocapture, surveys) so prompts
   * can state project-level product enablement instead of agents
   * inferring it from repo evidence. Null on signup flows.
   */
  project?: ApiProject | null;
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

/** @deprecated Use wizardAbort() directly for new code. */
export async function abort(message?: string, status?: number): Promise<never> {
  return wizardAbort({ message, exitCode: status });
}

export function isInGitRepo(): boolean {
  try {
    childProcess.execSync('git rev-parse --show-toplevel', {
      stdio: 'ignore',
    });
  } catch {
    return false;
  }
  return true;
}

const FREEMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'outlook.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'mail.com',
  'protonmail.com',
  'proton.me',
  'live.com',
  'aol.com',
  'yandex.com',
  'zoho.com',
  'gmx.com',
  'fastmail.com',
]);

function parseGitRemote(): { org: string; repo: string } | null {
  try {
    const url = childProcess
      .execSync('git remote get-url origin', {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      .toString()
      .trim();
    // git@github.com:acme-corp/my-app.git or https://github.com/acme-corp/my-app.git
    const match = url.match(/[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (match) return { org: match[1], repo: match[2] };
  } catch {
    // not in a git repo or no remote
  }
  return null;
}

export function detectOrgAndProject(email: string): {
  orgName: string | undefined;
  projectName: string | undefined;
} {
  const remote = parseGitRemote();

  // Project name: git repo name > directory name
  const projectName = remote?.repo || basename(process.cwd()) || undefined;

  // Org name: git remote org > email domain (skip freemail)
  let orgName: string | undefined;
  if (remote?.org) {
    orgName = remote.org;
  } else {
    const domain = email.split('@')[1]?.toLowerCase();
    if (domain && !FREEMAIL_DOMAINS.has(domain)) {
      orgName = domain.split('.')[0];
    }
  }

  return { orgName, projectName };
}

export function getUncommittedOrUntrackedFiles(): string[] {
  let gitStatus: string;
  try {
    gitStatus = childProcess
      .execSync('git status --porcelain=v1', {
        // we only care about stdout
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      .toString();
  } catch {
    return [];
  }

  const result: string[] = [];
  for (const rawLine of gitStatus.split(os.EOL)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^\S+\s+(\S+)/.exec(line);
    result.push(`- ${match?.[1]}`);
  }
  return result;
}

export async function isReact19Installed({
  installDir,
}: Pick<WizardRunOptions, 'installDir'>): Promise<boolean> {
  try {
    const packageJson = await tryGetPackageJson({ installDir });
    if (!packageJson) return false;
    const reactVersion = getDeclaredVersion('react', packageJson);

    if (!reactVersion) {
      return false;
    }

    return versionSatisfiesRange({
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
  integration,
  installDir,
}: {
  packageName: string;
  alreadyInstalled: boolean;
  packageNameDisplayLabel?: string;
  packageManager?: PackageManager;
  integration?: string;
  installDir: string;
}): Promise<{ packageManager?: PackageManager }> {
  return withProgress('install-package', async () => {
    const sdkInstallSpinner = getUI().spinner();

    const pkgManager =
      packageManager || (await getPackageManager({ installDir }));

    const isReact19 = await isReact19Installed({ installDir });
    const legacyPeerDepsFlag =
      isReact19 && pkgManager.name === 'npm' ? '--legacy-peer-deps' : '';

    sdkInstallSpinner.start(
      `${alreadyInstalled ? 'Updating' : 'Installing'} ${
        packageNameDisplayLabel ?? packageName
      } with ${pkgManager.label}.`,
    );

    const execAsync = promisify(childProcess.exec);
    const installCommand =
      `${pkgManager.installCommand} ${packageName} ${pkgManager.flags} ${legacyPeerDepsFlag}`.trim();

    try {
      await execAsync(installCommand, { cwd: installDir });
    } catch (e) {
      const { stdout = '', stderr = '' } = (e ?? {}) as {
        stdout?: string;
        stderr?: string;
      };
      fs.writeFileSync(
        join(
          process.cwd(),
          `posthog-wizard-installation-error-${Date.now()}.log`,
        ),
        JSON.stringify({ stdout, stderr }),
        { encoding: 'utf8' },
      );
      sdkInstallSpinner.stop('Installation failed.');
      getUI().log.error(
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        `Encountered the following error during installation:\n\n${e}\n\nThe wizard has created a \`posthog-wizard-installation-error-*.log\` file. If you think this issue is caused by the PostHog wizard, create an issue on GitHub and include the log file's content:\n${ISSUES_URL}`,
      );
      await abort();
    }

    sdkInstallSpinner.stop(
      `${alreadyInstalled ? 'Updated' : 'Installed'} ${
        packageNameDisplayLabel ?? packageName
      } with ${pkgManager.label}.`,
    );

    analytics.wizardCapture('package installed', {
      package_name: packageName,
      package_manager: pkgManager.name,
      integration,
    });

    return { packageManager: pkgManager };
  });
}

/**
 * Get package.json or abort the wizard if not found.
 * Only use where package.json is required (e.g., package install, overrides).
 * For detection/version-checks, use tryGetPackageJson() instead.
 */
export async function getPackageDotJson({
  installDir,
}: Pick<WizardRunOptions, 'installDir'>): Promise<PackageJson> {
  const pkgPath = join(installDir, 'package.json');

  let raw: string;
  try {
    raw = await fs.promises.readFile(pkgPath, 'utf8');
  } catch {
    getUI().log.error(
      'Could not find package.json. Make sure to run the wizard in the root of your app!',
    );
    await abort();
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as PackageJson | null;
    return parsed ?? {};
  } catch {
    getUI().log.error(
      `Unable to parse your package.json. Make sure it has a valid format!`,
    );
    await abort();
    return {};
  }
}

/**
 * Try to get package.json, returning null if it doesn't exist.
 * Use this for detection purposes where missing package.json is expected (e.g., Python projects).
 */
export async function tryGetPackageJson({
  installDir,
}: Pick<WizardRunOptions, 'installDir'>): Promise<PackageJson | null> {
  try {
    const packageJsonFileContents = await fs.promises.readFile(
      join(installDir, 'package.json'),
      'utf8',
    );
    return JSON.parse(packageJsonFileContents) as PackageJson;
  } catch {
    return null;
  }
}

export async function updatePackageDotJson(
  packageDotJson: PackageJson,
  { installDir }: Pick<WizardRunOptions, 'installDir'>,
): Promise<void> {
  const pkgPath = join(installDir, 'package.json');
  const serialized = JSON.stringify(packageDotJson, null, 2);

  try {
    await fs.promises.writeFile(pkgPath, serialized, {
      encoding: 'utf8',
      flag: 'w',
    });
    return;
  } catch {
    getUI().log.error(`Unable to update your package.json.`);
    await abort();
  }
}

/**
 * Detect and return the package manager. Pure — no prompts.
 * Falls back to first detected or npm if ambiguous.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function getPackageManager(
  options: Pick<WizardRunOptions, 'installDir'> & { ci?: boolean },
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
}: Pick<WizardRunOptions, 'installDir'>): boolean {
  try {
    fs.accessSync(join(installDir, 'tsconfig.json'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Get project data for the wizard via OAuth or CI API key.
 */
export async function getOrAskForProjectData(
  _options: Pick<WizardRunOptions, 'signup' | 'ci' | 'apiKey' | 'projectId'> & {
    email?: string;
    region?: CloudRegion;
    /** Explicit base URL override (`--base-url`, from `session.baseUrl`). When
     *  set, pins every PostHog origin and bypasses region resolution. */
    baseUrl?: string;
    /** `--local-mcp`: forwarded into the resolved host so `host.mcpUrl` is local. */
    localMcp?: boolean;
    /** Optional — picks the OAuth scope set via
     *  `getOAuthScopesForProgram`. Omitted → default
     *  `WIZARD_OAUTH_SCOPES`. Threaded into `askForWizardLogin`. */
    programId?: ProgramId | null;
  },
): Promise<{
  host: HostResolution;
  projectApiKey: string;
  accessToken: string;
  projectId: number;
  roleAtOrganization: string | null;
  user: ApiUser | null;
  project: ApiProject | null;
}> {
  // CI mode: bypass OAuth, use personal API key for LLM gateway
  if (_options.ci && _options.apiKey) {
    getUI().log.info('Using provided API key (CI mode - OAuth bypassed)');

    const host = await HostResolution.fromAccessToken(_options.apiKey, {
      region: _options.region,
      localMcp: _options.localMcp,
      baseUrl: _options.baseUrl,
    });
    const cloudUrl = host.appHost;

    const projectData =
      _options.projectId != null
        ? await fetchProjectDataById(
            _options.apiKey,
            _options.projectId,
            cloudUrl,
          )
        : await fetchProjectDataWithApiKey(_options.apiKey, cloudUrl);

    // Best-effort user fetch — CI flows may run with project-scoped keys
    // that 403 on /api/users/@me/, so swallow errors and continue with
    // a null user (and null role).
    let user: ApiUser | null = null;
    let roleAtOrganization: string | null = null;
    try {
      user = await fetchUserData(_options.apiKey, cloudUrl);
      roleAtOrganization = user.role_at_organization ?? null;
    } catch (err) {
      logToFile(
        '[ci-auth] user lookup failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
    if (user) {
      analytics.identifyUser(user);
      logToFile(
        '[ci-auth] identified via API key; flags evaluate as the key owner',
      );
    } else {
      getUI().log.warn(
        'Could not resolve the API key user (key needs user:read scope) — feature flags evaluate anonymously; user-targeted flags will not match.',
      );
    }

    return {
      host,
      projectApiKey: projectData.api_token,
      accessToken: _options.apiKey,
      projectId: projectData.id,
      roleAtOrganization,
      user,
      project: projectData.project,
    };
  }

  const {
    host,
    projectApiKey,
    accessToken,
    projectId,
    roleAtOrganization,
    user,
    project,
  } = await withProgress('login', () =>
    askForWizardLogin({
      signup: _options.signup,
      email: _options.email,
      region: _options.region,
      baseUrl: _options.baseUrl,
      programId: _options.programId,
      projectId: _options.projectId,
      localMcp: _options.localMcp,
    }),
  );

  if (!projectApiKey) {
    const cloudUrl = host.appHost;
    getUI().log.error(`Didn't receive a project token. This shouldn't happen :(

Please let us know if you think this is a bug in the wizard:
${ISSUES_URL}`);

    getUI().log
      .info(`In the meantime, we'll add a dummy project token ("${DUMMY_PROJECT_API_KEY}") for you to replace later.
You can find your project token here:
${cloudUrl}/settings/project#variables`);
  }

  return {
    accessToken,
    host,
    projectApiKey: projectApiKey || DUMMY_PROJECT_API_KEY,
    projectId,
    roleAtOrganization: roleAtOrganization ?? null,
    user: user ?? null,
    project: project ?? null,
  };
}

async function fetchProjectDataWithApiKey(
  apiKey: string,
  cloudUrl: string,
): Promise<{ api_token: string; id: number; project: ApiProject }> {
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
    project: projectData,
  };
}

async function fetchProjectDataById(
  apiKey: string,
  projectId: number,
  cloudUrl: string,
): Promise<{ api_token: string; id: number; project: ApiProject }> {
  const projectData = await fetchProjectData(apiKey, projectId, cloudUrl);
  return {
    api_token: projectData.api_token,
    id: projectId,
    project: projectData,
  };
}

async function askForWizardLogin(options: {
  signup: boolean;
  email?: string;
  region?: CloudRegion;
  /** Explicit base URL override (`--base-url`); pins every PostHog origin. */
  baseUrl?: string;
  /** Used to pick the right scope set via `getOAuthScopesForProgram`.
   *  Omitted → default `WIZARD_OAUTH_SCOPES`. */
  programId?: ProgramId | null;
  /** `--project-id`, if passed. When the user granted access to it on the consent
   *  screen we use it directly; otherwise we fall back to the first granted team. */
  projectId?: number;
  /** `--local-mcp`: forwarded into the resolved host so `host.mcpUrl` is local. */
  localMcp?: boolean;
}): Promise<ProjectData> {
  if (options.signup) {
    return askForProvisioningSignup(
      options.email,
      options.region,
      options.baseUrl,
      options.localMcp,
    );
  }

  const tokenResponse = await performOAuthFlow({
    scopes: [...getOAuthScopesForProgram(options.programId)],
    signup: false,
    projectId: options.projectId,
    baseUrl: options.baseUrl,
  });

  try {
    assertWizardCompletionScope(tokenResponse.scope);
  } catch (error) {
    const scopeError =
      error instanceof Error ? error : new Error('OAuth scope check failed');
    analytics.captureException(scopeError, {
      step: 'wizard_login',
      missing_scope: 'event_definition:write',
    });
    getUI().log.error(scopeError.message);
    await abort();
  }

  // `--project-id`, when provided, is authoritative — but only if the user actually
  // granted access to it on the consent screen. If they authorized a different
  // project, fail loudly instead of silently capturing into the wrong one. With no
  // `--project-id` this falls back to the granted project, unchanged for every program.
  const resolution = resolveGrantedProject(
    options.projectId,
    tokenResponse.scoped_teams,
  );
  if (!resolution.ok) {
    const error = new Error(
      `You authorized project ${resolution.granted}, but setup is targeting project ${resolution.requested}. Re-run and grant access to project ${resolution.requested} on the authorization screen.`,
    );
    analytics.captureException(error, {
      step: 'wizard_login',
      requested_project_id: resolution.requested,
      granted_project_id: resolution.granted,
    });
    getUI().log.error(error.message);
    await abort();
  }

  const projectId = resolution.ok ? resolution.projectId : undefined;

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

  // The issuing region comes with the token; the us/eu @me probe only runs when omitted.
  const host = await HostResolution.fromAccessToken(
    tokenResponse.access_token,
    {
      region: tokenResponse.posthog_region,
      localMcp: options.localMcp,
      baseUrl: options.baseUrl,
    },
  );
  const cloudUrl = host.appHost;

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
    roleAtOrganization: userData.role_at_organization ?? null,
    user: userData,
    project: projectData,
  };

  getUI().log.success('Login complete.');
  analytics.setTag('opened-wizard-link', true);
  analytics.identifyUser(userData);

  return data;
}

async function askForProvisioningSignup(
  email?: string,
  region?: CloudRegion,
  baseUrl?: string,
  localMcp?: boolean,
): Promise<ProjectData> {
  if (!email || !email.includes('@')) {
    getUI().log.error(
      'Email is required for signup. Use --email your@email.com with --signup.',
    );
    await abort();
    throw new Error('unreachable');
  }

  const spinner = getUI().spinner();
  spinner.start('Creating your PostHog account...');

  try {
    const provisionRegion = (region ?? 'us').toUpperCase() as 'US' | 'EU';
    const { orgName, projectName } = detectOrgAndProject(email);
    const result = await provisionNewAccount(email, '', provisionRegion, {
      orgName,
      projectName,
      baseUrl,
    });

    spinner.stop('Account created!');
    getUI().log.success('Welcome to PostHog!');

    const host = HostResolution.fromApiHost(result.host, { localMcp });

    analytics.setTag('provisioning-signup', true);

    return {
      accessToken: result.accessToken,
      projectApiKey: result.projectApiKey,
      host,
      distinctId: email,
      projectId: parseInt(result.projectId, 10) || 0,
    };
  } catch (error) {
    spinner.stop('Account creation failed.');
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.includes('already associated')) {
      getUI().log.info(
        'This email already has a PostHog account. Switching to login flow...',
      );

      return askForWizardLogin({ signup: false, baseUrl, localMcp });
    }

    getUI().log.error(`Failed to create account: ${message}`);
    analytics.captureException(
      error instanceof Error ? error : new Error(message),
      { step: 'provisioning_signup' },
    );
    await abort();
    throw error;
  }
}

/**
 * Creates a new config file with the given filepath and codeSnippet.
 */
export async function createNewConfigFile(
  filepath: string,
  codeSnippet: string,
  { installDir }: Pick<WizardRunOptions, 'installDir'>,
  moreInformation?: string,
): Promise<boolean> {
  if (!isAbsolute(filepath)) {
    debug(`createNewConfigFile: filepath is not absolute: ${filepath}`);
    return false;
  }

  const prettyFilename = relative(installDir, filepath);

  try {
    await fs.promises.writeFile(filepath, codeSnippet);

    getUI().log.success(`Added new ${prettyFilename} file.`);

    if (moreInformation) {
      getUI().log.info(moreInformation);
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
