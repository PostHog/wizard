import type { E2eResultPayload } from './e2e-result.js';
import { RunPhase } from '@shared/run-state';

export type LiveE2eResult = Partial<
  Pick<
    E2eResultPayload,
    | 'runPhase'
    | 'abort'
    | 'screenPath'
    | 'skillsComplete'
    | 'hasPosthogDep'
    | 'envFile'
    | 'tasks'
  >
>;

export type CapturedFrame = { name: string; text: string };

function readTrimmedFile(
  file: string | undefined,
  readFile: (file: string) => string,
): string {
  if (!file?.trim()) return '';
  try {
    return readFile(file.trim()).trim();
  } catch {
    return '';
  }
}

/** Resolve the same personal key for preflight and the real TUI host. */
export function readPersonalApiKey(
  env: NodeJS.ProcessEnv,
  readFile: (file: string) => string,
): string {
  return (
    env.POSTHOG_PERSONAL_API_KEY?.trim() ||
    readTrimmedFile(env.POSTHOG_KEY_FILE, readFile)
  );
}

export function credentialFailures(
  env: NodeJS.ProcessEnv,
  readFile: (file: string) => string,
): string[] {
  const failures: string[] = [];
  if (!readPersonalApiKey(env, readFile)) {
    failures.push(
      'Set POSTHOG_PERSONAL_API_KEY or POSTHOG_KEY_FILE to a readable PostHog personal key.',
    );
  }
  if (!readTrimmedFile(env.WIZARD_CI_GATEWAY_TOKEN_FILE, readFile)) {
    failures.push(
      'Set WIZARD_CI_GATEWAY_TOKEN_FILE to a readable, already-issued gateway token file.',
    );
  }
  const projectId = env.PROJECT_ID ?? env.POSTHOG_WIZARD_PROJECT_ID;
  if (!projectId || !/^[1-9]\d*$/.test(projectId)) {
    failures.push(
      'Set PROJECT_ID or POSTHOG_WIZARD_PROJECT_ID to a positive project ID.',
    );
  }
  return failures;
}

export function integrationFailures(
  result: LiveE2eResult | null,
  frames: CapturedFrame[],
): string[] {
  if (!result) return ['The TUI host did not write a structured result.'];

  const failures: string[] = [];
  if (result.runPhase !== RunPhase.Completed) {
    failures.push(
      `Agent run did not complete (phase: ${result.runPhase ?? 'missing'}).`,
    );
  }
  if (result.abort) failures.push(`Wizard aborted: ${result.abort}`);
  if (!result.screenPath?.includes('keep-skills')) {
    failures.push('Full TUI flow did not reach keep-skills.');
  }
  if (result.skillsComplete !== true) {
    failures.push('Full TUI flow did not complete the skills decision.');
  }
  if (!result.hasPosthogDep && !result.envFile) {
    failures.push(
      'Integration added neither a PostHog dependency nor an env file.',
    );
  }
  if (!result.tasks?.some((task) => task.status === 'completed')) {
    failures.push('No completed task appeared in the run ledger.');
  }
  const runFrames = frames.filter((frame) => /-run\.ans$/.test(frame.name));
  if (new Set(runFrames.map((frame) => frame.text)).size < 2) {
    failures.push('No changing run frames were captured.');
  }
  return failures;
}
