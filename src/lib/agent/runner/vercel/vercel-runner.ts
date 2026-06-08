import type { TextStreamPart, ToolSet } from 'ai';
import { getWizardCommandments } from '../../commandments';
import type { Runner, RunnerRunArgs, RunnerResult } from '../index';
import { concludeRun, concludeError } from '../shared/conclude';
import { createGatewayAnthropicModel } from '../shared/model';
import {
  setupRun,
  driveStream,
  MAX_AGENT_TURNS,
  type RunEvent,
} from '../shared/run-loop';
import { createVercelTools } from './tools';

/**
 * The `vercel` runner — wraps the Vercel AI SDK's `ToolLoopAgent`, which owns
 * the tool-calling loop over the gateway-pointed `@ai-sdk/anthropic` model.
 *
 * It mirrors `runAgent`'s contract: same arguments, same `{ error?, message? }`
 * result, same spinner/TUI side effects. {@link setupRun} builds the shared
 * scaffolding, {@link vercelEvents} translates the SDK stream into neutral
 * events, and {@link driveStream} / `conclude*` drive the bridge and result
 * identically to the `pi` runner — so the only vercel-specific code here is the
 * SDK agent construction and its event translation.
 *
 * Out of scope here (per the runner epic): canUseTool + YARA security parity
 * (#525) and live MCP tool hosting — the gateway MCP servers are projected to
 * neutral descriptors and logged, but the AI SDK has no built-in MCP client, so
 * wiring them as callable tools is tracked separately. The flag stays off until
 * those land.
 */
export class VercelRunner implements Runner {
  async run(...args: RunnerRunArgs): Promise<RunnerResult> {
    const rc = setupRun(args, 'vercel');

    // The AI SDK is ESM-only; load it lazily so constructing the runner (and
    // unit-testing selection) doesn't pull in the SDK — mirrors getSDKModule.
    const { ToolLoopAgent, stepCountIs } = await import('ai');
    const agent = new ToolLoopAgent({
      model: await createGatewayAnthropicModel(
        rc.agentConfig.model,
        rc.metadata,
        rc.flags,
      ),
      tools: await createVercelTools(rc.toolCtx),
      instructions: getWizardCommandments(),
      stopWhen: stepCountIs(MAX_AGENT_TURNS),
    });

    try {
      const stream = await agent.stream({
        prompt: rc.prompt,
        abortSignal: rc.abortController.signal,
      });
      const error = await driveStream(
        vercelEvents(stream.fullStream),
        rc.bridge,
        rc.abort,
      );
      // A yielded error means the loop ended on a transport/model failure rather
      // than a clean stop or an in-band [ABORT]; route it through the mapping.
      if (error && !rc.bridge.abort) return concludeError(error, rc.conclude);
      return concludeRun(rc.conclude);
    } catch (error) {
      return concludeError(error, rc.conclude);
    }
  }
}

/**
 * Translate the AI SDK `fullStream` into neutral run events. Assistant text
 * streams as deltas, so accumulate per text-block id and emit the whole block on
 * `text-end` — markers split across deltas then still parse.
 */
async function* vercelEvents(
  fullStream: AsyncIterable<TextStreamPart<ToolSet>>,
): AsyncGenerator<RunEvent> {
  const blocks = new Map<string, string>();
  for await (const part of fullStream) {
    switch (part.type) {
      case 'text-delta':
        blocks.set(part.id, (blocks.get(part.id) ?? '') + part.text);
        break;
      case 'text-end': {
        const text = blocks.get(part.id) ?? '';
        blocks.delete(part.id);
        if (text) yield { kind: 'assistantText', text };
        break;
      }
      case 'error':
        yield { kind: 'error', error: part.error };
        break;
      default:
        break;
    }
  }
}
