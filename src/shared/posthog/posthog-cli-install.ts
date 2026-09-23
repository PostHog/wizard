import { spawnSync } from 'node:child_process';

import { debug } from '@utils/debug';

export interface CliInstallResult {
  success: boolean;
  error?: string;
  /** The spawn failure or a synthesized non-zero-exit error. */
  errorObject?: Error;
}

export const cliSpawnOptions = {
  encoding: 'utf-8' as const,
  // npm/posthog-cli are npm.cmd/posthog-cli.cmd on Windows.
  shell: process.platform === 'win32',
};

/** Install or update the PostHog CLI with npm in the user's environment. */
export function installOrUpdatePostHogCli(): CliInstallResult {
  const args = ['install', '--global', '@posthog/cli@latest'];
  debug(`Running npm ${args.join(' ')}`);

  const result = spawnSync('npm', args, cliSpawnOptions);

  if (result.error) {
    return {
      success: false,
      error: `Failed to run npm: ${result.error.message}. Is Node.js installed?`,
      errorObject: result.error,
    };
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    const message =
      detail ||
      `npm install --global @posthog/cli@latest exited with status ${
        result.status ?? 'unknown'
      }`;
    return {
      success: false,
      error: message,
      errorObject: new Error(message),
    };
  }
  return { success: true };
}
