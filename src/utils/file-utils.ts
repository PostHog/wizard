import path from 'path';
import fs from 'fs';
import type { WizardOptions } from './types';

export function getDotGitignore({
  installDir,
}: Pick<WizardOptions, 'installDir'>) {
  const gitignorePath = path.join(installDir, '.gitignore');
  const gitignoreExists = fs.existsSync(gitignorePath);

  if (gitignoreExists) {
    return gitignorePath;
  }

  return undefined;
}

/**
 * Directory names to skip when recursively scanning a project tree.
 * Used by detection logic (e.g. finding all package.json files) to avoid
 * dependency directories, build output, virtual environments, etc.
 *
 * For fast-glob `ignore` patterns, map this to `**\/<name>/**`.
 */
export const IGNORED_DIRS = new Set<string>([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  'dist',
  'build',
  'out',
  'coverage',
  '.coverage',
  'venv',
  '.venv',
  '__pycache__',
  '.pytest_cache',
  'vendor',
  'target',
  '.gradle',
  '.idea',
  '.vscode',
]);
