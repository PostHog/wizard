/**
 * Public entry of the agent. Code outside `src/agent` imports runtime values
 * from here and types from `./types`; deeper imports fail lint and the
 * architecture test. Keep this list to what callers use, and keep it cheap:
 * the startup chunk imports this module, so anything re-exported here loads
 * before the wizard does any work. Heavy paths stay behind a lazy import.
 *
 * Grouped by fate, per the stack plan (sections 4.1 to 4.5 and 7).
 */

import type { RunAgentOptions, RunConfig, RunInput, RunResult } from './types';

/**
 * Stays. The agent's contract: the one way to run it, the marker strings
 * program prompts embed, the tool ids programs put in allowedTools and
 * disallowedTools, and what programs resolve a binding with: the default
 * binding, the harness axis and each harness's task capability.
 */
export type * from './types';
export { RunOutcome } from './runner/shared/types';
export { AgentSignals } from './signals';
export { OutroKind } from './progress';
export { WIZARD_TOOL_NAMES } from './tools/tool-names';
export { DEFAULT_AGENT_BINDING } from './default-binding';
export {
  harnessRunsTasks,
  resolveHarness,
} from './runner/switchboard/resolve-harness';

/** Runs one agent pipeline; the runner loads on the first call. */
export async function runAgent(
  config: RunConfig,
  input: RunInput,
  options?: RunAgentOptions,
): Promise<RunResult> {
  const runner = await import('./runner');
  return runner.runAgent(config, input, options);
}

/** Leaves in C3 (M16, then D12), once skill install becomes shared. The installer loads on the first call. */
export async function downloadSkill(
  ...args: Parameters<typeof import('./tools/tools').downloadSkill>
): ReturnType<typeof import('./tools/tools').downloadSkill> {
  const tools = await import('./tools/tools');
  return tools.downloadSkill(...args);
}

/** The frameworkContext slot the legacy adapter fills for the e2e harness. */
export { TASK_OUTCOMES_KEY } from './runner/shared/types';

/**
 * Leaves in C2. The TUI receives agent data through program state. Until
 * then the suggested-prompts screen streams through this wrapper, which loads
 * the streaming module on first call so the startup chunk does not grow.
 */
export async function* runMcpPromptViaSdk(
  args: Parameters<
    typeof import('./mcp-prompt-streaming').runMcpPromptViaSdk
  >[0],
): AsyncIterable<import('./types').AgentChunk> {
  const streaming = await import('./mcp-prompt-streaming');
  yield* streaming.runMcpPromptViaSdk(args);
}
