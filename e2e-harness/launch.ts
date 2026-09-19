/** How the harness starts a controlled wizard: the real binary, API-key auth, a control socket, one program per command. */
import fs from 'fs';
import path from 'path';
import { HEADLESS_FLAG } from '@env';
import { ControlClient } from '@store/control';
import { getProgramConfig, Program } from '@store/programs';
import type { ProgramId } from '@store/types';

/** Programs whose launch words are not their `command`: the default flow has none, audit runs `audit all`. */
const COMMAND_OVERRIDES: Partial<Record<ProgramId, readonly string[]>> = {
  [Program.PostHogIntegration]: [],
  [Program.Audit]: ['audit', 'all'],
};

/** The command words that launch a program: the `command` its config declares, unless overridden. */
export function launchWords(programId: ProgramId): readonly string[] {
  const override = COMMAND_OVERRIDES[programId];
  if (override) return override;
  let command: string | undefined;
  try {
    command = getProgramConfig(programId).command;
  } catch {
    command = undefined;
  }
  if (!command) throw new Error(`no launch command for program ${programId}`);
  return [command];
}

export interface LaunchOptions {
  programId: ProgramId;
  appDir: string;
  socketPath: string;
  projectId: string;
  region?: 'us' | 'eu';
  /** The personal API key. Travels in the environment, never in argv. */
  apiKey?: string;
  /** `tui` (default) drives the real screens with `--ci`; `headless` uses the published headless flag. */
  surface?: 'tui' | 'headless';
  /** Keep `wizard_ask` wired so the parent answers the agent's questions (TUI surface). */
  e2eAsk?: boolean;
  /** Self-driving only: skip the integration check and integrate first. */
  integrate?: boolean;
  harness?: string;
  sequence?: string;
  model?: string;
  /** Dump task-stream payloads; '' means the default path. */
  taskStreamLog?: string;
  /** The entry to run; a `.js` file runs under node, anything else under tsx. */
  bin?: string;
  env?: NodeJS.ProcessEnv;
}

export interface Launch {
  cmd: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/** Outer agent credentials would make the wizard's agent defer to them. */
const STRIPPED_ENV = /^(CLAUDE|ANTHROPIC|AI_AGENT)/;

export function buildLaunch(o: LaunchOptions, cwd = process.cwd()): Launch {
  const bin = o.bin ?? 'bin.ts';
  const headless = o.surface === 'headless';
  const args = [
    bin,
    ...launchWords(o.programId),
    headless ? `--${HEADLESS_FLAG}` : '--ci',
    '--control-socket',
    o.socketPath,
    '--install-dir',
    o.appDir,
    '--project-id',
    o.projectId,
    '--region',
    o.region ?? 'us',
  ];
  if (o.e2eAsk && !headless) args.push('--e2e-ask');
  if (o.integrate === true && o.programId === Program.SelfDriving) {
    args.push('--integrate');
  }
  if (o.harness) args.push('--harness', o.harness);
  if (o.sequence) args.push('--sequence', o.sequence);
  if (o.model) args.push('--model', o.model);
  if (o.taskStreamLog !== undefined) {
    args.push('--task-stream-log', o.taskStreamLog);
  }

  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(o.env ?? process.env)) {
    if (!STRIPPED_ENV.test(k)) env[k] = v;
  }
  // The linear sequence honours this; the orchestrator asks regardless.
  env.WIZARD_ASK_AUTODRIVE = '1';
  if (o.apiKey) env.POSTHOG_WIZARD_API_KEY = o.apiKey;
  else delete env.POSTHOG_WIZARD_API_KEY;
  const cmd = bin.endsWith('.js')
    ? 'node'
    : path.join(cwd, 'node_modules/.bin/tsx');
  return { cmd, args, env };
}

/** Resolve once the wizard answers on its socket, or reject after `timeoutMs`. */
export async function waitForSocket(
  socketPath: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const client = new ControlClient(socketPath);
  while (Date.now() < deadline) {
    if (fs.existsSync(socketPath)) {
      try {
        await client.health();
        return;
      } catch {
        // A stale file or a server still binding; try again.
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(
    `the wizard did not answer on ${socketPath} within ${timeoutMs}ms`,
  );
}

/** The key from the environment: inline first, else the key file. */
export function readApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.POSTHOG_PERSONAL_API_KEY ??
    (env.POSTHOG_KEY_FILE ? fs.readFileSync(env.POSTHOG_KEY_FILE, 'utf8') : '')
  ).trim();
}
