import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { debug } from '@utils/debug';

/**
 * A coding agent whose global instructions file the PostHog CLI steering
 * snippet can be installed into. Project-level installs are handled by
 * `posthog-cli api agents-md install` in the target repo; this step only
 * manages the per-user (global) instruction files.
 */
export interface CliSteeringTarget {
  id: string;
  name: string;
  /** Global agent instructions file the steering snippet is written to. */
  instructionsPath(): string;
  /** Whether the agent appears to be installed on this machine. */
  isDetected(): boolean;
}

const dirExists = (...segments: string[]): boolean => {
  try {
    return fs.existsSync(path.join(os.homedir(), ...segments));
  } catch {
    return false;
  }
};

export const CLI_STEERING_TARGETS: readonly CliSteeringTarget[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    instructionsPath: () => path.join(os.homedir(), '.claude', 'CLAUDE.md'),
    isDetected: () => dirExists('.claude'),
  },
  {
    id: 'codex',
    name: 'Codex',
    instructionsPath: () => path.join(os.homedir(), '.codex', 'AGENTS.md'),
    isDetected: () => dirExists('.codex'),
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    instructionsPath: () => path.join(os.homedir(), '.gemini', 'GEMINI.md'),
    isDetected: () => dirExists('.gemini'),
  },
];

export function findTarget(id: string): CliSteeringTarget | undefined {
  return CLI_STEERING_TARGETS.find((target) => target.id === id);
}

export function detectTargets(): CliSteeringTarget[] {
  return CLI_STEERING_TARGETS.filter((target) => target.isDetected());
}

export interface SteeringInstallResult {
  success: boolean;
  filePath: string;
  error?: string;
}

export interface CliInstallResult {
  success: boolean;
  error?: string;
}

const spawnOptions = {
  encoding: 'utf-8' as const,
  // npm/posthog-cli are npm.cmd/posthog-cli.cmd on Windows; spawnSync only
  // resolves them through a shell.
  shell: process.platform === 'win32',
};

/**
 * User-writable prefix the CLI falls back to when npm's global prefix is
 * read-only (e.g. a Nix-managed Node in `/nix/store`).
 */
const FALLBACK_PREFIX = path.join(os.homedir(), '.posthog');

/** npm drops global binaries in `<prefix>/bin` on Unix and `<prefix>` on Windows. */
const fallbackBinDir =
  process.platform === 'win32'
    ? FALLBACK_PREFIX
    : path.join(FALLBACK_PREFIX, 'bin');

/** True when npm failed because it could not write to its global prefix. */
function isPermissionError(detail: string): boolean {
  return /EACCES|EROFS|EPERM|permission denied/i.test(detail);
}

/** Prepend a directory to PATH so later `posthog-cli` spawns resolve it. */
function prependToPath(dir: string): void {
  const current = process.env.PATH ?? '';
  if (current.split(path.delimiter).includes(dir)) return;
  process.env.PATH = current ? `${dir}${path.delimiter}${current}` : dir;
}

function runNpmInstall(extraArgs: string[]): CliInstallResult {
  const args = ['install', '--global', ...extraArgs, '@posthog/cli@latest'];
  debug(`Running npm ${args.join(' ')}`);

  const result = spawnSync('npm', args, spawnOptions);

  if (result.error) {
    return {
      success: false,
      error: `Failed to run npm: ${result.error.message}. Is Node.js installed?`,
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
    };
  }
  return { success: true };
}

/**
 * Install or update the PostHog CLI in the user's environment. `npm install
 * --global @posthog/cli@latest` covers both first-time installs and upgrades
 * for existing npm-installed CLIs.
 *
 * When npm's global prefix is read-only — a Nix-managed Node lives in the
 * read-only `/nix/store`, so the global install dies with `EACCES` — retry
 * against a user-writable prefix and put its `bin` directory on PATH so the
 * later `posthog-cli` spawns resolve.
 */
export function installOrUpdatePostHogCli(): CliInstallResult {
  const first = runNpmInstall([]);
  if (first.success || !isPermissionError(first.error ?? '')) {
    return first;
  }

  const retry = runNpmInstall(['--prefix', FALLBACK_PREFIX]);
  if (retry.success) {
    prependToPath(fallbackBinDir);
  }
  return retry;
}

/**
 * Delegate the actual write to the installed `posthog-cli api agents-md
 * install`. The steering snippet lives in the CLI (its single source of truth),
 * so the command should run only after `installOrUpdatePostHogCli` refreshes
 * the CLI to the latest release.
 */
export function installSteeringSnippet(
  filePath: string,
): SteeringInstallResult {
  const args = ['api', 'agents-md', 'install', '--path', filePath];
  debug(`Running posthog-cli ${args.join(' ')}`);

  const result = spawnSync('posthog-cli', args, {
    ...spawnOptions,
    env: { ...process.env, POSTHOG_CLI_EXPERIMENTAL_API: '1' },
  });

  if (result.error) {
    return {
      success: false,
      filePath,
      error: `Failed to run posthog-cli: ${result.error.message}. Make sure npm's global bin directory is on your PATH.`,
    };
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    return {
      success: false,
      filePath,
      error:
        detail ||
        `posthog-cli exited with status ${result.status ?? 'unknown'}`,
    };
  }
  return { success: true, filePath };
}
