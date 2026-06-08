import { getUI } from '../../../../ui';
import { logToFile } from '../../../../utils/debug';
import type { RunnerRunArgs } from '../index';
import { RunBridge } from './run-bridge';
import type { ConcludeOptions } from './conclude';
import { extractHttpMcpDescriptors, type HttpMcpDescriptor } from './mcp';
import type { TaskEntry, ToolContext } from './tools/types';

/**
 * Upper bound on agent loop turns for the model-agnostic runners — a backstop
 * against a runaway loop, set well above any real program's tool-call count.
 * The Anthropic SDK path lets the model decide when to stop; the OpenAI Agents
 * SDK otherwise caps at 10 turns (far too low) and the AI SDK has no default
 * cap, so both challengers pin to this shared value.
 */
export const MAX_AGENT_TURNS = 200;

/**
 * A normalized stream event. Each runner translates its SDK's native stream
 * (AI SDK `fullStream` parts, OpenAI Agents run items) into this neutral shape,
 * so the loop that feeds the bridge lives here once.
 */
export type RunEvent =
  | { kind: 'assistantText'; text: string }
  | { kind: 'error'; error: unknown };

/**
 * Per-run scaffolding shared by every runner: the bridge, the tool context, the
 * conclusion options, the projected MCP descriptors, and the abort handle.
 * {@link setupRun} builds it from the `runAgent` arguments so a runner's body is
 * just its SDK-specific agent construction and loop.
 */
export interface RunContext {
  agentConfig: RunnerRunArgs[0];
  prompt: string;
  metadata: Record<string, string>;
  flags: Record<string, string>;
  bridge: RunBridge;
  toolCtx: ToolContext;
  conclude: ConcludeOptions;
  mcpDescriptors: HttpMcpDescriptor[];
  abortController: AbortController;
  /** Abort the run's loop (bound to `abortController`). */
  abort: () => void;
}

/**
 * Build the shared run scaffolding and start the spinner. The result feeds the
 * SDK-specific agent and the shared {@link driveStream} / conclude helpers.
 */
export function setupRun(args: RunnerRunArgs, label: string): RunContext {
  const [agentConfig, prompt, , spinner, config] = args;
  const {
    spinnerMessage = 'Customizing your PostHog setup...',
    successMessage = 'PostHog integration complete',
    errorMessage = 'Integration failed',
  } = config ?? {};

  spinner.start(spinnerMessage);
  logToFile(`[${label}] starting run`, { model: agentConfig.model });

  const bridge = new RunBridge(getUI(), spinner);
  const toolCtx: ToolContext = {
    workingDirectory: agentConfig.workingDirectory,
    tasks: new Map<string, TaskEntry>(),
    onTasksChange: (t) => bridge.syncTasks(t),
  };
  const abortController = new AbortController();

  // agentConfig.mcpServers is the SDK's untyped (`any`) config map; narrow it
  // to the record shape the neutral descriptor extractor expects.
  const mcpDescriptors = extractHttpMcpDescriptors(
    agentConfig.mcpServers as Record<string, unknown> | undefined,
  );
  logToFile(
    `[${label}] MCP descriptors: ${
      mcpDescriptors.map((d) => d.name).join(', ') || '(none)'
    }`,
  );

  return {
    agentConfig,
    prompt,
    metadata: agentConfig.wizardMetadata ?? {},
    flags: agentConfig.wizardFlags ?? {},
    bridge,
    toolCtx,
    mcpDescriptors,
    abortController,
    abort: () => abortController.abort(),
    conclude: {
      bridge,
      spinner,
      startTime: Date.now(),
      successMessage,
      errorMessage,
      label,
    },
  };
}

/**
 * Drive a runner's normalized event stream into the bridge: assistant text →
 * TUI + signals (aborting the loop on the first `[ABORT]`); a yielded error is
 * returned for the caller to route through `concludeError`. Errors that throw
 * mid-stream propagate to the caller's try/catch instead.
 */
export async function driveStream(
  events: AsyncIterable<RunEvent>,
  bridge: RunBridge,
  abort: () => void,
): Promise<unknown> {
  let streamError: unknown;
  for await (const event of events) {
    if (event.kind === 'assistantText') {
      if (bridge.handleAssistantText(event.text).abort) abort();
    } else {
      streamError = event.error;
    }
  }
  return streamError;
}
