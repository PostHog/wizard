/** Idle watchdog for gateway model streams; `createGatewayRuntime` loads it, so pi-ai stays out of the harness entry's static graph. */

import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import { streamSimple as streamAnthropicMessages } from '@earendil-works/pi-ai/api/anthropic-messages';
import { streamSimple as streamOpenAiCompletions } from '@earendil-works/pi-ai/api/openai-completions';
import { streamSimple as streamOpenAiResponses } from '@earendil-works/pi-ai/api/openai-responses';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import type { GatewayApi } from './gateway';

/** Longest silence a model stream may keep before it is cut and retried. */
export const STREAM_IDLE_TIMEOUT_MS = 120_000;

export type StreamSimple = (
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

const BUILT_IN_STREAMS: Record<GatewayApi, StreamSimple> = {
  'anthropic-messages': streamAnthropicMessages as StreamSimple,
  'openai-completions': streamOpenAiCompletions as StreamSimple,
  'openai-responses': streamOpenAiResponses as StreamSimple,
};

function emptyMessage(model: Model<Api>): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'error',
    timestamp: Date.now(),
  };
}

/** Wrap a stream function so a stream silent for `idleMs` ends as a retryable error. */
export function withStreamIdleTimeout(
  stream: StreamSimple,
  idleMs: number = STREAM_IDLE_TIMEOUT_MS,
): StreamSimple {
  return (model, context, options) => {
    const out = createAssistantMessageEventStream();
    const controller = new AbortController();
    const callerSignal = options?.signal;
    const forwardAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) forwardAbort();
    else callerSignal?.addEventListener('abort', forwardAbort, { once: true });

    let partial: AssistantMessage | undefined;
    let events = 0;
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (event: AssistantMessageEvent) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', forwardAbort);
      out.push(event);
      out.end();
    };
    // The text must match pi's retryable-error pattern ("timed out", "ended without").
    const fail = (errorMessage: string) =>
      finish({
        type: 'error',
        reason: 'error',
        error: {
          ...(partial ?? emptyMessage(model)),
          stopReason: 'error',
          errorMessage,
        },
      });
    const onIdle = () => {
      logToFile(
        `[pi] model stream idle for ${idleMs}ms after ${events} events; retrying`,
      );
      analytics.wizardCapture('llm stream stalled', {
        model: model.id,
        idle_timeout_ms: idleMs,
        events_received: events,
      });
      fail(`Model stream timed out: no data for ${idleMs / 1000}s`);
      controller.abort();
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(onIdle, idleMs);
    };

    const inner = stream(model, context, {
      ...options,
      signal: controller.signal,
    });
    void (async () => {
      arm();
      try {
        for await (const event of inner) {
          if (finished) return;
          events += 1;
          if (event.type === 'done' || event.type === 'error') {
            finish(event);
            return;
          }
          partial = event.partial;
          arm();
          out.push(event);
        }
        fail('Model stream ended without a final event');
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    })();
    return out;
  };
}

/** The built-in stream for a gateway transport, behind the idle watchdog. */
export function gatewayStreamSimple(api: GatewayApi): StreamSimple {
  return withStreamIdleTimeout(BUILT_IN_STREAMS[api]);
}
