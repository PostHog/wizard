import fs from 'fs';
import path from 'path';
import { hasPackageInstalled } from './package-json';
import { tryGetPackageJson } from './clack-utils';

/** PostHog package names to check in Python dependency files. */
const PYTHON_POSTHOG_PATTERN = /^posthog([<>=~!\s[]|$)/im;

/** Check if a PostHog SDK is installed in a project directory. */
export async function hasPostHogInstalled(dir: string): Promise<boolean> {
  // Check JS/TS projects via package.json
  const packageJson = await tryGetPackageJson({ installDir: dir });
  if (packageJson) {
    const posthogPackages = [
      'posthog-js',
      'posthog-node',
      'posthog-react-native',
    ];
    for (const pkg of posthogPackages) {
      if (hasPackageInstalled(pkg, packageJson)) {
        return true;
      }
    }
  }

  // Check Python projects via requirements*.txt and pyproject.toml
  if (
    (await fileMatchesPattern(
      path.join(dir, 'requirements.txt'),
      PYTHON_POSTHOG_PATTERN,
    )) ||
    (await fileMatchesPattern(
      path.join(dir, 'requirements-dev.txt'),
      PYTHON_POSTHOG_PATTERN,
    )) ||
    (await fileMatchesPattern(
      path.join(dir, 'pyproject.toml'),
      PYTHON_POSTHOG_PATTERN,
    ))
  ) {
    return true;
  }

  // Check PHP/Laravel projects via composer.json
  if (await composerHasPosthog(path.join(dir, 'composer.json'))) {
    return true;
  }

  return false;
}

async function fileMatchesPattern(
  filePath: string,
  pattern: RegExp,
): Promise<boolean> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return pattern.test(content);
  } catch {
    return false;
  }
}

async function composerHasPosthog(filePath: string): Promise<boolean> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const json = JSON.parse(content) as {
      require?: Record<string, string>;
      'require-dev'?: Record<string, string>;
    };
    const allDeps = {
      ...(json.require ?? {}),
      ...(json['require-dev'] ?? {}),
    };
    return Object.keys(allDeps).some(
      (dep) => dep === 'posthog/posthog-php' || dep.startsWith('posthog/'),
    );
  } catch {
    return false;
  }
}
