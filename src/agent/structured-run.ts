import { AgentErrorType, StructuredOutputError } from './agent-interface';
import { prepareRun } from './runner/shared/bootstrap';
import { getHarness } from './runner/switchboard/harness';
import type { RunConfig, RunInput } from './runner/shared/types';
import type {
  AgentResult,
  BackendRunInputs,
  StructuredRun,
} from './runner/harness/types';

/** How a schema-bound run ended. `timeout` and `invalid` are worth one retry, `failed` is not. */
export type StructuredOutcome =
  | { kind: 'output'; value: unknown }
  | { kind: 'timeout' }
  | { kind: 'invalid'; error: Error }
  | { kind: 'failed'; error: Error };

/** Execute a schema-bound mechanical run without integration lifecycle steps. */
export async function executeStructuredAgent(
  config: RunConfig,
  input: RunInput,
  options: Pick<
    BackendRunInputs,
    'prompt' | 'emit' | 'spinner' | 'middleware'
  > &
    StructuredRun,
): Promise<StructuredOutcome> {
  const { schema, timeoutMs, ...run } = options;
  const boot = await prepareRun(config, input);
  const result = await getHarness(config.binding.harness).run({
    ...run,
    config,
    input,
    boot,
    model: config.binding.model,
    thinkingLevel: config.binding.thinkingLevel,
    structured: { schema, timeoutMs },
  });
  return structuredOutcome(result);
}

function structuredOutcome(result: AgentResult): StructuredOutcome {
  switch (result.kind) {
    case 'success':
      return { kind: 'output', value: result.structuredOutput };
    case 'decided_failure':
      return {
        kind: 'failed',
        error: result.failure.error ?? new Error(result.failure.message),
      };
    case 'abort':
    case 'failure': {
      const error =
        result.error ??
        new Error(result.message || `Agent error: ${result.classification}`);
      if (result.classification === AgentErrorType.AGENTIC_DETECTION_TIMEOUT)
        return { kind: 'timeout' };
      // NO_PROGRESS: Pi stopped without using a tool, so it never scanned.
      if (
        result.classification === AgentErrorType.NO_PROGRESS ||
        error instanceof StructuredOutputError
      )
        return { kind: 'invalid', error };
      return { kind: 'failed', error };
    }
  }
}
