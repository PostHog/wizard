/**
 * Backend selection. Resolves the `wizard-runner` flag to an `AgentBackend`
 * inside the linear mode (orthogonal to the mode fork in `runner/index.ts`).
 * Unknown/missing → `anthropic`. The active backend is logged every run so
 * telemetry and the log file attribute the run to a backend.
 */

import { WIZARD_RUNNER_FLAG_KEY } from '../../../constants';
import { logToFile } from '../../../../utils/debug';
import { anthropicBackend } from './anthropic';
import type { AgentBackend } from './types';

export type { AgentBackend, AgentResult, BackendRunInputs } from './types';

export function selectBackend(
  flags: Record<string, string> = {},
): AgentBackend {
  const variant = flags[WIZARD_RUNNER_FLAG_KEY];

  let backend: AgentBackend;
  switch (variant) {
    case 'pi':
      // pi backend lands in a follow-up; resolve to the control until then.
      backend = anthropicBackend;
      break;
    case 'anthropic':
    default:
      backend = anthropicBackend;
      break;
  }

  logToFile(
    `[runner] wizard-runner=${variant ?? '(unset)'} → ${backend.name}`,
  );
  return backend;
}
