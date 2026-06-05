import { getUI } from '../../../../ui';
import { logToFile } from '../../../../utils/debug';
import { AgentSignals } from '../../signals';
import { getWizardCommandments } from '../../commandments';
import type { Runner, RunnerRunArgs, RunnerResult } from '../index';
import { RunBridge } from '../shared/run-bridge';
import { concludeRun, concludeError } from '../shared/conclude';
import { extractHttpMcpDescriptors } from '../shared/mcp';
import type { TaskEntry, ToolContext } from '../shared/tools/types';
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
 * result, same spinner/TUI side effects. The shared {@link RunBridge} turns the
 * streamed assistant messages and task mutations into the same TUI updates and
 * signal-derived results the Anthropic SDK path produces; {@link concludeRun} /
 * {@link concludeError} handle the post-loop tail.
 *
 * Out of scope here (per the runner epic): canUseTool + YARA security parity
 * (#525). The flag stays off until that lands.
 */
export class PiRunner implements Runner {
  async run(...args: RunnerRunArgs): Promise<RunnerResult> {
    const [agentConfig, prompt, , spinner, config, middleware] = args;
    const {
      spinnerMessage = 'Customizing your PostHog setup...',
      successMessage = 'PostHog integration complete',
      errorMessage = 'Integration failed',
    } = config ?? {};

    spinner.start(spinnerMessage);
    const startTime = Date.now();
    logToFile('[pi] starting run', { model: agentConfig.model });

    const tasks = new Map<string, TaskEntry>();
    const bridge = new RunBridge(getUI(), spinner);
    const ctx: ToolContext = {
      workingDirectory: agentConfig.workingDirectory,
      tasks,
      onTasksChange: (t) => bridge.syncTasks(t),
    };
    const conclude = {
      bridge,
      spinner,
      startTime,
      successMessage,
      errorMessage,
      label: 'pi',
      middleware,
    };

    // agentConfig.mcpServers is the SDK's untyped (`any`) config map; narrow it
    // to the record shape the neutral descriptor extractor expects.
    const mcpDescriptors = extractHttpMcpDescriptors(
      agentConfig.mcpServers as Record<string, unknown> | undefined,
    );
    logToFile(
      `[pi] MCP descriptors: ${
        mcpDescriptors.map((d) => d.name).join(', ') || '(none)'
      }`,
    );

    // The SDK is ESM-only; load it lazily so constructing the runner (and
    // unit-testing selection) doesn't pull in the SDK — mirrors getSDKModule.
    const { Agent, run } = await import('@openai/agents');

    const abortController = new AbortController();
    let mcpServers: Awaited<ReturnType<typeof createPiMcpServers>> = [];
    try {
      mcpServers = await createPiMcpServers(mcpDescriptors);
      const model = await createPiModel(
        agentConfig.model,
        agentConfig.wizardMetadata ?? {},
        agentConfig.wizardFlags ?? {},
      );
      const tools = await createPiTools(ctx);

      const agent = new Agent({
        name: 'PostHog Wizard',
        instructions: getWizardCommandments(),
        model,
        tools,
        mcpServers,
      });

      const result = await run(agent, prompt, {
        stream: true,
        signal: abortController.signal,
      });

      for await (const event of result) {
        try {
          middleware?.onMessage(event);
        } catch (e) {
          logToFile(`${AgentSignals.BENCHMARK} Middleware onMessage error:`, e);
        }

        // Each completed assistant message arrives as a run-item event; flush
        // the whole message text to the bridge so markers parse intact.
        if (
          event.type === 'run_item_stream_event' &&
          event.item.type === 'message_output_item'
        ) {
          const { abort } = bridge.handleAssistantText(event.item.content);
          if (abort) abortController.abort();
        }
      }
      // Surface any error the stream deferred to completion.
      await result.completed;
    } catch (error) {
      return concludeError(error, conclude);
    } finally {
      await closePiMcpServers(mcpServers);
    }

    return concludeRun({
      ...conclude,
      finalizeMessage: { type: 'result', subtype: 'success' },
    });
  }
}
