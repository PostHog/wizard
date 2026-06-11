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

/**
 * Delegate the actual write to `posthog-cli api agents-md install`, pinned to
 * `@posthog/cli@latest` via npx. The steering snippet lives in the CLI (its
 * single source of truth), so going through the latest release means a rerun
 * always refreshes the installed `<posthog>` block to the current content
 * instead of baking a copy into the wizard that would go stale.
 */
export function installSteeringSnippet(
  filePath: string,
): SteeringInstallResult {
  const args = [
    '-y',
    '@posthog/cli@latest',
    'api',
    'agents-md',
    'install',
    '--path',
    filePath,
  ];
  debug(`Running npx ${args.join(' ')}`);

  const result = spawnSync('npx', args, {
    encoding: 'utf-8',
    env: { ...process.env, POSTHOG_CLI_EXPERIMENTAL_API: '1' },
    // npx is npx.cmd on Windows; spawnSync only resolves it through a shell.
    shell: process.platform === 'win32',
  });

  if (result.error) {
    return {
      success: false,
      filePath,
      error: `Failed to run npx: ${result.error.message}. Is Node.js installed?`,
    };
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    return {
      success: false,
      filePath,
      error: detail || `npx exited with status ${result.status ?? 'unknown'}`,
    };
  }
  return { success: true, filePath };
}
