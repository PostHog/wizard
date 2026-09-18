import type { ProgramRunConfig } from '@lib/program-run';
import type { ProgramConfig, ProgramStep } from './program-step.js';

/** Gated step ids between the `auth` and the first `run` step, in order. */
export function postAuthGateIdsFor(steps: readonly ProgramStep[]): string[] {
  const authIndex = steps.findIndex((s) => s.screenId === 'auth');
  const runIndex = steps.findIndex((s) => s.screenId === 'run');
  if (authIndex === -1 || runIndex <= authIndex) return [];
  return steps
    .slice(authIndex + 1, runIndex)
    .filter((s) => s.gate)
    .map((s) => s.id);
}

/** The run contract the agent receives for a program. */
export function runConfigFor(config: ProgramConfig): ProgramRunConfig {
  return {
    ...config,
    postAuthGateIds: postAuthGateIdsFor(config.steps),
    healthCheckDeclared: config.steps.some(
      (s) => s.screenId === 'health-check',
    ),
  };
}
