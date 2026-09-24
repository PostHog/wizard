import { prepareRun } from './runner/shared/bootstrap';
import { getHarness } from './runner/switchboard/harness';
import type { RunConfig, RunInput } from './runner/shared/types';
import type { BackendRunInputs, AgentResult } from './runner/harness/types';

/** Execute a schema-bound mechanical run without integration lifecycle steps. */
export async function executeStructuredAgent(
  config: RunConfig,
  input: RunInput,
  options: Pick<
    BackendRunInputs,
    'prompt' | 'emit' | 'signal' | 'spinner' | 'middleware'
  >,
): Promise<AgentResult> {
  const boot = await prepareRun(config, input);
  return getHarness(config.binding.harness).run({
    ...options,
    config,
    input,
    boot,
    model: config.binding.model,
    thinkingLevel: config.binding.thinkingLevel,
  });
}
