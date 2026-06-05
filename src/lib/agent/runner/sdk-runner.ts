import { runAgent } from '../agent-interface';
import type { Runner, RunnerRunArgs, RunnerResult } from './index';

/**
 * Today's execution path. Delegates verbatim to the SDK-backed `runAgent` in
 * agent-interface.ts, which sets the gateway env vars, builds the MCP servers,
 * and drives the `@anthropic-ai/claude-agent-sdk` `query()` loop.
 *
 * PR 01 wraps (rather than relocates) that function so the diff stays a pure
 * seam with no behavior change; the body moves here once HarnessRunner is
 * built alongside it.
 */
export class SdkRunner implements Runner {
  run(...args: RunnerRunArgs): Promise<RunnerResult> {
    return runAgent(...args);
  }
}
