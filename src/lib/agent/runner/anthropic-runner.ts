import { runAgent } from '../agent-interface';
import type { Runner, RunnerRunArgs, RunnerResult } from './index';

/**
 * The `anthropic` variant — today's execution path. Delegates verbatim to the
 * SDK-backed `runAgent` in agent-interface.ts, which sets the gateway env vars,
 * builds the MCP servers, and drives the `@anthropic-ai/claude-agent-sdk`
 * `query()` loop.
 *
 * This is the control runner: a thin wrapper, not a rewrite, so the diff stays
 * a pure seam.
 */
export class AnthropicRunner implements Runner {
  run(...args: RunnerRunArgs): Promise<RunnerResult> {
    return runAgent(...args);
  }
}
