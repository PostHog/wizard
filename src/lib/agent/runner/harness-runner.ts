import {
  AgentErrorType,
  handleSDKMessage,
  type TaskEntry,
} from '../agent-interface';
import { getWizardCommandments } from '../commandments';
import { analytics } from '../../../utils/analytics';
import {
  POSTHOG_FLAG_HEADER_PREFIX,
  POSTHOG_PROPERTY_HEADER_PREFIX,
} from '../../constants';
import {
  streamMessages,
  MessagesApiError,
  type MessagesResponse,
  type MessagesToolUseBlock,
  type MessagesTurn,
} from './messages-client';
import { createToolDispatcher, toAnthropicTools } from './tools/registry';
import type { ToolContext } from './tools/types';
import type { Runner, RunnerResult, RunnerRunArgs } from './index';

/**
 * In-house agent loop against the PostHog LLM gateway — the eventual
 * replacement for `sdk.query()`.
 *
 * This PR (02) is a scaffold: it proves text-only turns, streaming, and stop
 * handling against the gateway. Tool dispatch is stubbed (a real dispatcher
 * lands in PR 03), and the YARA hooks / canUseTool gate land in PR 05. The
 * runner is only selected when `wizard-open-code-runner` is enabled (0%
 * rollout), so it is fully dark and cannot affect the SDK path.
 *
 * Gateway URL and auth token are read from the env vars `initializeAgent`
 * already sets (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN), so the harness
 * reuses the exact transport configuration the SDK path uses.
 */

/** A tool_use handed back by the model, resolved to a tool_result. */
export interface HarnessToolResult {
  content: unknown;
  isError?: boolean;
}

export interface HarnessToolDispatcher {
  dispatch(block: MessagesToolUseBlock): Promise<HarnessToolResult>;
}

export interface HarnessRunnerDeps {
  /** Injectable streaming transport (defaults to the real Messages client). */
  streamFn?: typeof streamMessages;
  dispatcher?: HarnessToolDispatcher;
  /** Runaway guard: max assistant turns before the loop bails. */
  maxTurns?: number;
}

// Anthropic requires an explicit per-turn output cap. Generous enough for the
// long edit/explain turns the wizard produces.
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_MAX_TURNS = 100;
const ABORT_PATTERN = /\[ABORT\]\s*(.+?)(?:\n|$)/;

export class HarnessRunner implements Runner {
  private readonly streamFn: typeof streamMessages;
  private readonly dispatcherOverride?: HarnessToolDispatcher;
  private readonly maxTurns: number;

  constructor(deps: HarnessRunnerDeps = {}) {
    this.streamFn = deps.streamFn ?? streamMessages;
    this.dispatcherOverride = deps.dispatcher;
    this.maxTurns = deps.maxTurns ?? DEFAULT_MAX_TURNS;
  }

  async run(...args: RunnerRunArgs): Promise<RunnerResult> {
    const [agentConfig, prompt, options, spinner, config] = args;
    const {
      spinnerMessage = 'Customizing your PostHog setup...',
      successMessage = 'PostHog integration complete',
      abortCases = [],
    } = config ?? {};

    const baseUrl = process.env.ANTHROPIC_BASE_URL;
    const authToken =
      process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.CLAUDE_CODE_OAUTH_TOKEN;
    if (!baseUrl || !authToken) {
      // initializeAgent sets these before run(); their absence is a wiring bug.
      return {
        error: AgentErrorType.API_ERROR,
        message: 'Harness runner: gateway URL or auth token not configured',
      };
    }

    const headers = buildHarnessHeaders(
      agentConfig.wizardMetadata ?? {},
      agentConfig.wizardFlags ?? {},
    );

    spinner.start(spinnerMessage);
    const startTime = Date.now();
    const collectedText: string[] = [];
    const tasks = new Map<string, TaskEntry>();
    const abortController = new AbortController();
    const ctx: ToolContext = {
      workingDirectory: agentConfig.workingDirectory,
      tasks,
    };
    const dispatcher = this.dispatcherOverride ?? createToolDispatcher(ctx);
    const tools = toAnthropicTools();

    // TODO(harness): system is only the wizard commandments here. The SDK path
    // uses the bundled claude_code system-prompt preset and appends these; the
    // harness must source an equivalent base prompt before ramp (PR 07).
    const system = getWizardCommandments();
    const messages: MessagesTurn[] = [{ role: 'user', content: prompt }];

    try {
      for (let turn = 0; turn < this.maxTurns; turn++) {
        const response = await this.streamFn(
          {
            model: agentConfig.model,
            system,
            messages,
            tools,
            maxTokens: DEFAULT_MAX_TOKENS,
          },
          { baseUrl, authToken, headers, signal: abortController.signal },
        );

        // Reuse the SDK path's message handler for UI parity (assistant text,
        // [STATUS]/[DASHBOARD_URL]/[NOTEBOOK_URL] markers, collectedText).
        handleSDKMessage(
          toAssistantMessage(response),
          options,
          spinner,
          collectedText,
          false,
          tasks,
        );

        // [ABORT]: the skill emits "[ABORT] <reason>" when it can't complete.
        const abortReason = findAbortReason(response);
        if (abortReason && abortCases.length > 0) {
          abortController.abort();
          return { error: AgentErrorType.ABORT, message: abortReason };
        }

        const toolUses = response.content.filter(
          (b): b is MessagesToolUseBlock => b.type === 'tool_use',
        );
        if (response.stopReason !== 'tool_use' || toolUses.length === 0) {
          // end_turn / stop_sequence — the agent is done.
          return this.complete(successMessage, spinner, startTime);
        }

        // Dispatch tool calls and feed results back as the next user turn.
        messages.push({ role: 'assistant', content: response.content });
        const results = await Promise.all(
          toolUses.map(async (block) => {
            const result = await dispatcher.dispatch(block);
            return {
              type: 'tool_result' as const,
              tool_use_id: block.id,
              content: stringifyToolContent(result.content),
              is_error: result.isError ?? false,
            };
          }),
        );
        messages.push({ role: 'user', content: results });
      }

      // Runaway guard tripped.
      spinner.stop('Agent exceeded the maximum number of turns');
      return {
        error: AgentErrorType.API_ERROR,
        message: `Harness runner exceeded ${this.maxTurns} turns without completing`,
      };
    } catch (error) {
      return mapError(error, spinner);
    }
  }

  private complete(
    successMessage: string,
    spinner: RunnerRunArgs[3],
    startTime: number,
  ): RunnerResult {
    const durationMs = Date.now() - startTime;
    analytics.wizardCapture('agent completed', {
      duration_ms: durationMs,
      duration_seconds: Math.round(durationMs / 1000),
    });
    spinner.stop(successMessage);
    return {};
  }
}

/**
 * Build the HTTP headers the gateway expects, mirroring `buildAgentEnv` in
 * agent-interface.ts (which encodes the same set into ANTHROPIC_CUSTOM_HEADERS
 * for the SDK). Always sends the Bedrock-fallback header; adds wizard metadata
 * (X-POSTHOG-PROPERTY-*) and wizard feature flags (X-POSTHOG-FLAG-*).
 */
export function buildHarnessHeaders(
  wizardMetadata: Record<string, string>,
  wizardFlags: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    'x-posthog-use-bedrock-fallback': 'true',
  };
  for (const [key, value] of Object.entries(wizardMetadata)) {
    const name = key.startsWith(POSTHOG_PROPERTY_HEADER_PREFIX)
      ? key
      : `${POSTHOG_PROPERTY_HEADER_PREFIX}${key}`;
    headers[name] = value;
  }
  for (const [flagKey, variant] of Object.entries(wizardFlags)) {
    if (!flagKey.toLowerCase().startsWith('wizard')) continue;
    headers[POSTHOG_FLAG_HEADER_PREFIX + flagKey.toUpperCase()] = variant;
  }
  return headers;
}

/** Wrap an assembled assistant turn in the SDK message shape handleSDKMessage reads. */
function toAssistantMessage(
  response: MessagesResponse,
): Parameters<typeof handleSDKMessage>[0] {
  // Only text blocks: tool_use (incl. Task*) is executed by the harness
  // dispatcher, so we must not let handleSDKMessage re-process Task blocks.
  const textBlocks = response.content.filter((b) => b.type === 'text');
  return {
    type: 'assistant',
    message: { role: 'assistant', content: textBlocks },
  } as unknown as Parameters<typeof handleSDKMessage>[0];
}

function findAbortReason(response: MessagesResponse): string | null {
  for (const block of response.content) {
    if (block.type === 'text') {
      const match = block.text.match(ABORT_PATTERN);
      if (match) return match[1].trim();
    }
  }
  return null;
}

function stringifyToolContent(content: unknown): string {
  return typeof content === 'string' ? content : JSON.stringify(content);
}

function mapError(error: unknown, spinner: RunnerRunArgs[3]): RunnerResult {
  if (error instanceof MessagesApiError && error.status === 429) {
    spinner.stop('Rate limited');
    return { error: AgentErrorType.RATE_LIMIT, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  spinner.stop('Agent run failed');
  return { error: AgentErrorType.API_ERROR, message };
}
