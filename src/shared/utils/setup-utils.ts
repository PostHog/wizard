import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import { basename, join } from 'node:path';
import {
  type PackageManager,
  detectAllPackageManagers,
  NPM as npm,
} from './package-manager';
import type { WizardRunOptions } from './types';
import { getDeclaredVersion, tryGetPackageJson } from './package-json';
import { analytics } from './analytics';
import { versionSatisfiesRange } from './semver';

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
