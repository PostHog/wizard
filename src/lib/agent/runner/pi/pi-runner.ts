import { getWizardCommandments } from '../../commandments';
import type { Runner, RunnerRunArgs, RunnerResult } from '../index';
import { concludeRun, concludeError } from '../shared/conclude';
import { setupRun, driveStream, type RunEvent } from '../shared/run-loop';
import { createPiModel } from './model';
import { createPiTools } from './tools';
import { createPiMcpServers, closePiMcpServers } from './mcp';

/**
 * The `pi` runner — wraps the OpenAI Agents SDK's `run()` loop over a
 * model-agnostic model (the gateway-pointed `@ai-sdk/anthropic` model adapted
 * via `@openai/agents-extensions`' `aisdk()`). The SDK owns the tool-calling
 * loop, streaming, and — unlike the `vercel` runner — first-class MCP hosting,
 * so the PostHog MCP servers are live here via `mcpServers`.
 *
 * It mirrors `runAgent`'s contract: same arguments, same `{ error?, message? }`
 * result, same spinner/TUI side effects. {@link setupRun} builds the shared
 * scaffolding and {@link driveStream} / `conclude*` drive the bridge and result
 * identically to the `vercel` runner — so the only pi-specific code here is the
 * SDK agent construction (with live MCP servers) and translating its run stream
 * into neutral events.
 *
 * Out of scope here (per the runner epic): canUseTool + YARA security parity
 * (#525) and per-variant benchmark instrumentation (#527). The flag stays off
 * until those land.
 */
export class PiRunner implements Runner {
  async run(...args: RunnerRunArgs): Promise<RunnerResult> {
    const rc = setupRun(args, 'pi');

    // The SDK is ESM-only; load it lazily so constructing the runner (and
    // unit-testing selection) doesn't pull in the SDK — mirrors getSDKModule.
    const { Agent, run } = await import('@openai/agents');

    let mcpServers: Awaited<ReturnType<typeof createPiMcpServers>> = [];
    try {
      mcpServers = await createPiMcpServers(rc.mcpDescriptors);
      const agent = new Agent({
        name: 'PostHog Wizard',
        instructions: getWizardCommandments(),
        model: await createPiModel(rc.agentConfig.model, rc.metadata, rc.flags),
        tools: await createPiTools(rc.toolCtx),
        mcpServers,
      });

      const result = await run(agent, rc.prompt, {
        stream: true,
        signal: rc.abortController.signal,
      });

      // Translate the SDK run stream into neutral events: each completed
      // assistant message arrives as a `message_output_item` run-item event, so
      // flush its whole text and markers split across it parse intact. Errors the
      // SDK defers to completion surface by awaiting `result.completed`, which
      // throws into the catch below.
      const piEvents = async function* (): AsyncGenerator<RunEvent> {
        for await (const event of result) {
          if (
            event.type === 'run_item_stream_event' &&
            event.item.type === 'message_output_item'
          ) {
            yield { kind: 'assistantText', text: event.item.content };
          }
        }
        await result.completed;
      };

      await driveStream(piEvents(), rc.bridge, rc.abort);
    } catch (error) {
      return concludeError(error, rc.conclude);
    } finally {
      // Close the live MCP servers before concluding, regardless of outcome.
      await closePiMcpServers(mcpServers);
    }

    return concludeRun(rc.conclude);
  }
}
