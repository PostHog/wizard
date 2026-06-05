import { getUI } from '../../../../ui';
import { logToFile } from '../../../../utils/debug';
import { getWizardCommandments } from '../../commandments';
import { AgentSignals } from '../../signals';
import type { Runner, RunnerRunArgs, RunnerResult } from '../index';
import { RunBridge } from '../shared/run-bridge';
import { concludeRun, concludeError } from '../shared/conclude';
import { extractHttpMcpDescriptors } from '../shared/mcp';
import type { TaskEntry, ToolContext } from '../shared/tools/types';
import { createGatewayModel } from './model';
import { createVercelTools } from './tools';

/**
 * Hard cap on agent loop steps. The `ToolLoopAgent` runs until the model stops
 * calling tools or this bound is hit — a backstop against a runaway loop, set
 * well above any real program's tool-call count.
 */
const MAX_STEPS = 200;

/**
 * The `vercel` runner — wraps the Vercel AI SDK's `ToolLoopAgent`, which owns
 * the tool-calling loop over the gateway-pointed `@ai-sdk/anthropic` model.
 *
 * It mirrors `runAgent`'s contract: same arguments, same `{ error?, message? }`
 * result, same spinner/TUI side effects. The shared {@link RunBridge} turns the
 * model's streamed assistant text and task mutations into the same TUI updates
 * and signal-derived results the Anthropic SDK path produces; {@link concludeRun}
 * / {@link concludeError} handle the post-loop tail identically to the SDK path.
 *
 * Out of scope here (per the runner epic): canUseTool + YARA security parity
 * (#525) and live MCP tool hosting — the gateway MCP servers are projected to
 * neutral descriptors and logged, but the AI SDK v6 has no built-in MCP client,
 * so wiring them as callable tools is tracked separately. The flag stays off
 * until those land.
 */
export class VercelRunner implements Runner {
  async run(...args: RunnerRunArgs): Promise<RunnerResult> {
    const [agentConfig, prompt, , spinner, config, middleware] = args;
    const {
      spinnerMessage = 'Customizing your PostHog setup...',
      successMessage = 'PostHog integration complete',
      errorMessage = 'Integration failed',
    } = config ?? {};

    spinner.start(spinnerMessage);
    const startTime = Date.now();
    logToFile('[vercel] starting run', { model: agentConfig.model });

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
      label: 'vercel',
      middleware,
    };

    // agentConfig.mcpServers is the SDK's untyped (`any`) config map; narrow it
    // to the record shape the neutral descriptor extractor expects.
    const mcpDescriptors = extractHttpMcpDescriptors(
      agentConfig.mcpServers as Record<string, unknown> | undefined,
    );
    logToFile(
      `[vercel] MCP descriptors: ${
        mcpDescriptors.map((d) => d.name).join(', ') || '(none)'
      }`,
    );

    // The AI SDK is ESM-only; load it lazily so constructing the runner (and
    // unit-testing selection) doesn't pull in the SDK — mirrors getSDKModule.
    const { ToolLoopAgent, stepCountIs } = await import('ai');
    const model = await createGatewayModel(
      agentConfig.model,
      agentConfig.wizardMetadata ?? {},
      agentConfig.wizardFlags ?? {},
    );
    const tools = await createVercelTools(ctx);

    const abortController = new AbortController();
    const agent = new ToolLoopAgent({
      model,
      tools,
      instructions: getWizardCommandments(),
      stopWhen: stepCountIs(MAX_STEPS),
    });

    // Assistant text streams as deltas; accumulate per text block id and flush
    // the whole block to the bridge so markers split across deltas still parse.
    const textBlocks = new Map<string, string>();
    let streamError: unknown;
    let finishUsage: Record<string, number> | undefined;

    try {
      const result = await agent.stream({
        prompt,
        abortSignal: abortController.signal,
      });

      for await (const part of result.fullStream) {
        try {
          middleware?.onMessage(part);
        } catch (e) {
          logToFile(`${AgentSignals.BENCHMARK} Middleware onMessage error:`, e);
        }

        switch (part.type) {
          case 'text-delta':
            textBlocks.set(
              part.id,
              (textBlocks.get(part.id) ?? '') + part.text,
            );
            break;
          case 'text-end': {
            const text = textBlocks.get(part.id) ?? '';
            textBlocks.delete(part.id);
            if (text) {
              const { abort } = bridge.handleAssistantText(text);
              if (abort) abortController.abort();
            }
            break;
          }
          case 'finish':
            finishUsage = {
              input_tokens: part.totalUsage.inputTokens ?? 0,
              output_tokens: part.totalUsage.outputTokens ?? 0,
              cache_read_input_tokens: part.totalUsage.cachedInputTokens ?? 0,
              cache_creation_input_tokens: 0,
            };
            break;
          case 'error':
            streamError = part.error;
            break;
          default:
            break;
        }
      }
    } catch (error) {
      return concludeError(error, conclude);
    }

    // A stream-level error part means the loop ended on a transport/model
    // failure rather than a clean stop — route it through the same mapping.
    if (streamError && !bridge.abort) {
      return concludeError(streamError, conclude);
    }

    return concludeRun({
      ...conclude,
      finalizeMessage: {
        type: 'result',
        subtype: 'success',
        usage: finishUsage,
      },
    });
  }
}
