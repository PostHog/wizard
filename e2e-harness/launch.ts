/**
 * How the harness starts a controlled wizard: the real binary, `--ci` for
 * API-key auth, `--control-socket` for the parent, one program per command.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Program } from '@store/programs';
import type { ProgramId } from '@store/types';

/** The command words that launch each program; the default flow has none. */
export const PROGRAM_COMMANDS: Partial<Record<ProgramId, readonly string[]>> = {
  [Program.PostHogIntegration]: [],
  [Program.AiObservability]: ['ai-observability'],
  [Program.Metrics]: ['metrics'],
  [Program.ReplayVision]: ['replay-vision'],
  [Program.SelfDriving]: ['self-driving'],
  [Program.ErrorTrackingUploadSourceMaps]: ['upload-source-maps'],
  [Program.ErrorTracking]: ['error-tracking'],
  [Program.WarehouseSource]: ['warehouse'],
  [Program.Audit]: ['audit', 'all'],
};

export interface LaunchOptions {
  programId: ProgramId;
  appDir: string;
  socketPath: string;
  projectId: string;
  region?: 'us' | 'eu';
  /** The personal API key. Travels in the environment, never in argv. */
  apiKey?: string;
  /** Keep `wizard_ask` wired so the parent answers the agent's questions. */
  e2eAsk?: boolean;
  /** Self-driving only: skip the integration check and integrate first. */
  integrate?: boolean;
  harness?: string;
  sequence?: string;
  model?: string;
  /** Dump task-stream payloads; '' means the default path. */
  taskStreamLog?: string;
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
  const words = PROGRAM_COMMANDS[o.programId];
  if (!words) throw new Error(`no launch command for program ${o.programId}`);
  const args = [
    'bin.ts',
    ...words,
    '--ci',
    '--control-socket',
    o.socketPath,
    '--install-dir',
    o.appDir,
    '--project-id',
    o.projectId,
    '--region',
    o.region ?? 'us',
  ];
  if (o.e2eAsk) args.push('--e2e-ask');
  if (o.integrate === true && o.programId === Program.SelfDriving)
    args.push('--integrate');
  if (o.harness) args.push('--harness', o.harness);
  if (o.sequence) args.push('--sequence', o.sequence);
  if (o.model) args.push('--model', o.model);
  if (o.taskStreamLog !== undefined)
    args.push('--task-stream-log', o.taskStreamLog);

  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(o.env ?? process.env)) {
    if (!STRIPPED_ENV.test(k)) env[k] = v;
  }
  // The linear sequence honours this; the orchestrator asks regardless.
  env.WIZARD_ASK_AUTODRIVE = '1';
  if (o.apiKey) env.POSTHOG_WIZARD_API_KEY = o.apiKey;
  else delete env.POSTHOG_WIZARD_API_KEY;
  return { cmd: path.join(cwd, 'node_modules/.bin/tsx'), args, env };
}

/** Resolve once the wizard listens on its socket, or reject after `timeoutMs`. */
export async function waitForSocket(
  socketPath: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(socketPath)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(
    `the wizard did not open ${socketPath} within ${timeoutMs}ms`,
  );
}

/** The key from the environment: inline first, else the key file. */
export function readApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.POSTHOG_PERSONAL_API_KEY ??
    (env.POSTHOG_KEY_FILE ? fs.readFileSync(env.POSTHOG_KEY_FILE, 'utf8') : '')
  ).trim();
}
