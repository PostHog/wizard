import type { Integration } from '@lib/constants';
import { withProgress } from '../telemetry';
import { analytics } from '@utils/analytics';
import { getUI } from '@ui';
import {
  tryGetPackageJson,
  getUncommittedOrUntrackedFiles,
  isInGitRepo,
} from '@utils/setup-utils';
import { hasDeclaredDependency } from '@utils/package-json';
import type { WizardRunOptions } from '@utils/types';
import * as childProcess from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Absolute path to the project's Prettier CLI entrypoint, or `null` when it
 * cannot be resolved.
 *
 * Prettier moved its binary between major versions (v2 ships `bin-prettier.js`,
 * v3 `bin/prettier.cjs`), so read the location out of Prettier's own
 * `package.json` instead of hardcoding it.
 */
function resolvePrettierBin(installDir: string): string | null {
  try {
    const requireFrom = createRequire(join(installDir, 'noop.js'));
    const packageJsonPath = requireFrom.resolve('prettier/package.json');
    const { bin } = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      bin?: string | Record<string, string>;
    };
    const binPath = typeof bin === 'string' ? bin : bin?.prettier;
    return binPath ? join(dirname(packageJsonPath), binPath) : null;
  } catch {
    return null;
  }
}

export async function runPrettierStep({
  installDir,
  integration,
}: Pick<WizardRunOptions, 'installDir'> & {
  integration: Integration;
}): Promise<void> {
  return withProgress('run-prettier', async () => {
    if (!isInGitRepo()) {
      // We only run formatting on changed files. If we're not in a git repo, we can't find
      // changed files. So let's early-return without showing any formatting-related messages.
      return;
    }

    const changedOrUntrackedFiles = getUncommittedOrUntrackedFiles();

    if (!changedOrUntrackedFiles.length) {
      // Likewise, if we can't find changed or untracked files, there's no point in running Prettier.
      return;
    }

    const packageJson = await tryGetPackageJson({ installDir });
    if (!packageJson) return;
    const prettierInstalled = hasDeclaredDependency('prettier', packageJson);

    analytics.setTag('prettier-installed', prettierInstalled);

    if (!prettierInstalled) {
      return;
    }

    const prettierBin = resolvePrettierBin(installDir);
    if (!prettierBin) {
      // Declared in package.json but not present in node_modules.
      return;
    }

    const prettierSpinner = getUI().spinner();
    prettierSpinner.start('Running Prettier on your files.');

    try {
      await new Promise<void>((resolve, reject) => {
        // Run the CLI under the current Node binary and pass filenames as argv
        // entries. Interpolating them into a shell command lets a filename such
        // as `a.ts;rm -rf .` execute as a command, and spawning `npx` would
        // reintroduce that shell on Windows, where it resolves to `npx.cmd`.
        // `--` stops Prettier reading a leading-dash filename as a flag.
        childProcess.execFile(
          process.execPath,
          [
            prettierBin,
            '--ignore-unknown',
            '--write',
            '--',
            ...changedOrUntrackedFiles,
          ],
          { shell: false },
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
      prettierSpinner.stop(
        'Prettier failed to run. You may want to format the changes manually.',
      );
      return;
    }

    prettierSpinner.stop('Prettier has formatted your files.');

    analytics.wizardCapture('ran prettier', {
      integration,
    });
  });
}
