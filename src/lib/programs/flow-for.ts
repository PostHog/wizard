import type { Flow } from '@lib/flow';
import { getProgramConfig, type ProgramId } from './program-registry.js';
import type { ProgramConfig } from './program-step.js';
import { withAiOptInGate } from './ai-opt-in-gate.js';

/** The flow a store walks for a program, with the AI opt-in gate injected. */
export function flowFor(programId: ProgramId): {
  flow: Flow;
  config: ProgramConfig;
} {
  const config = getProgramConfig(programId);
  return {
    config,
    flow: {
      programId,
      skillId: config.skillId ?? null,
      steps: withAiOptInGate(config),
    },
  };
}
