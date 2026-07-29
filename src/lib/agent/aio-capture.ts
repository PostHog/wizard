/**
 * aio-capture — mirror wizard LLM calls into the authenticated project's
 * AI Observability tab as `$ai_generation` events. Gated on `--capture-aio`
 * (dev/test builds only); returns a no-op instance when disabled so the
 * wire-in points stay a no-op with zero overhead.
 *
 * The wizard's LLM calls happen inside subprocesses we don't own (the
 * claude-agent-sdk CLI on the anthropic path, pi's own runtime on pi), so we
 * can't wrap the client with `posthog-node`'s `wrapAnthropic`. Instead, each
 * harness surfaces assistant turns on the way back — the SDK message stream
 * on anthropic, `agentSession.subscribe(message_end)` on pi — and this module
 * composes an `$ai_generation` event from either shape.
 *
 * For the Conversation tab in AIO to render anything, each generation needs
 * `$ai_input` (the messages the model saw when it produced this turn). The
 * initial prompt is passed to the SDK subprocess and never echoed back on
 * the stream, so callers must hand it to `setInitialPrompt` before the run
 * starts. From there we track user/assistant turns as they flow through the
 * stream, snapshotting the running conversation into each generation's
 * `$ai_input` and firing `$ai_input_state` / `$ai_output_state` on the
 * terminal `$ai_trace` event.
 *
 * POSTs are fire-and-forget: failures are debug-logged and never surfaced to
 * the main agent flow. Losing an AIO event must never break a run.
 */

import { logToFile } from '@utils/debug';
import { VERSION } from '@lib/version';

/** Conversation turn shape both harnesses normalize to. Matches Anthropic
 *  message role/content conventions, which is also what AIO's Conversation
 *  tab knows how to render. */
type Turn = { role: 'user' | 'assistant'; content: unknown };

/** Common shape both harness transforms emit; fed to the shared POST. */
type LLMTurn = {
  provider: 'anthropic' | 'openai';
  model: string;
  /** Conversation up to (but not including) this assistant turn — the
   *  messages the model saw. Sent as `$ai_input`. */
  input: Turn[];
  /** Content blocks (text + tool_use), passed through as $ai_output_choices. */
  outputChoices: unknown[];
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /** Wall-clock ms since the previous assistant turn on this stream. */
  latencyMs: number;
  generationId?: string;
  isError: boolean;
};

export type AioCapture = {
  /** Set the initial prompt the harness is about to send to the LLM. The
   *  wizard passes this into the SDK subprocess out-of-band, so it never
   *  appears on the return message stream — the caller must hand it to us
   *  explicitly if we want `$ai_input` to include it. Safe to call multiple
   *  times: latest wins, prior conversation state resets. */
  setInitialPrompt(prompt: string): void;
  /** Called for every SDK message on the anthropic harness stream. */
  captureFromAnthropicSDKMessage(msg: unknown): void;
  /** Called for every subscribe event on the pi harness. */
  captureFromPiMessageEndEvent(event: unknown): void;
};

const noop = (_: unknown): void => undefined;
const NOOP: AioCapture = {
  setInitialPrompt: noop,
  captureFromAnthropicSDKMessage: noop,
  captureFromPiMessageEndEvent: noop,
};

export function createAioCapture(args: {
  enabled: boolean;
  projectApiKey: string;
  apiHost: string;
  /** Trace tags from `buildRunTags` (program_id, integration, run_id, build, skill_id). */
  runTags: Record<string, string>;
}): AioCapture {
  if (!args.enabled || !args.projectApiKey || !args.apiHost) return NOOP;

  const { projectApiKey, apiHost, runTags } = args;
  const distinctId = `wizard-cli-${VERSION}`;
  const captureUrl = `${apiHost.replace(/\/$/, '')}/capture/`;
  const runStartAt = Date.now();
  // Latency is measured against the previous assistant turn on this stream —
  // a rough proxy for time-to-first-token that doesn't require SDK-internal
  // timings. Reset per createAioCapture (once per agent run).
  let prevTurnAt = runStartAt;
  // Fire the top-level `$ai_trace` event at most once per instance. Both
  // harnesses can emit terminal signals, and pi in particular may emit
  // multiple `agent_end` events across nudges — first-wins keeps trace
  // metadata stable in AIO.
  let traceEnded = false;

  // Running conversation state — grows as user and assistant turns flow
  // through the stream. Snapshotted into `$ai_input` on each generation.
  let initialPrompt: string | undefined;
  let conversation: Turn[] = [];
  let lastAssistantContent: unknown[] | undefined;

  const postEvent = (
    event: string,
    properties: Record<string, unknown>,
  ): void => {
    const body = {
      api_key: projectApiKey,
      event,
      distinct_id: distinctId,
      properties: {
        $ai_trace_id: runTags.run_id ?? '',
        ...runTags,
        ...properties,
      },
      timestamp: new Date().toISOString(),
    };

    // Fire-and-forget. `.then` + `.catch` (not `await`) so the caller returns
    // immediately; both branches only log. Errors must never propagate into
    // the agent stream loop.
    fetch(captureUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((res) => {
        if (!res.ok) {
          logToFile(`[aio-capture] POST failed status=${res.status}`);
        }
      })
      .catch((err) => {
        logToFile(
          `[aio-capture] POST error: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  };

  const postGeneration = (turn: LLMTurn): void => {
    postEvent('$ai_generation', {
      $ai_provider: turn.provider,
      $ai_model: turn.model,
      $ai_input: turn.input,
      $ai_output_choices: turn.outputChoices,
      $ai_input_tokens: turn.inputTokens ?? 0,
      $ai_output_tokens: turn.outputTokens ?? 0,
      $ai_cache_read_input_tokens: turn.cacheReadTokens ?? 0,
      $ai_cache_creation_input_tokens: turn.cacheCreationTokens ?? 0,
      $ai_latency: turn.latencyMs / 1000,
      $ai_generation_id: turn.generationId ?? '',
      $ai_is_error: turn.isError,
    });
  };

  // Emit the top-level `$ai_trace` event. Without this, PostHog builds a
  // pseudo-trace from the generations — the timeline and aggregates still
  // work, but the trace has no readable name and the Conversation tab shows
  // "No top-level trace event". Sending this once per run fills that in,
  // and `$ai_input_state` / `$ai_output_state` populate the trace-level
  // Conversation view.
  const sendTraceEnd = (opts: { isError: boolean }): void => {
    if (traceEnded) return;
    traceEnded = true;
    postEvent('$ai_trace', {
      $ai_span_name: runTags.program_id ?? 'wizard-run',
      $ai_latency: (Date.now() - runStartAt) / 1000,
      $ai_is_error: opts.isError,
      $ai_input_state: initialPrompt
        ? [{ role: 'user', content: [{ type: 'text', text: initialPrompt }] }]
        : [],
      $ai_output_state: lastAssistantContent ?? [],
    });
  };

  const anthropicAssistantTurn = (msg: unknown): LLMTurn | null => {
    const m = msg as {
      type?: string;
      message?: {
        id?: string;
        model?: string;
        content?: unknown;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
      };
    };
    if (m?.type !== 'assistant' || !m.message) return null;
    const now = Date.now();
    const latencyMs = now - prevTurnAt;
    prevTurnAt = now;
    return {
      provider: 'anthropic',
      model: m.message.model ?? 'unknown',
      input: [...conversation],
      outputChoices: Array.isArray(m.message.content) ? m.message.content : [],
      inputTokens: m.message.usage?.input_tokens,
      outputTokens: m.message.usage?.output_tokens,
      cacheReadTokens: m.message.usage?.cache_read_input_tokens,
      cacheCreationTokens: m.message.usage?.cache_creation_input_tokens,
      latencyMs,
      generationId: m.message.id,
      isError: false,
    };
  };

  const piAssistantTurn = (event: unknown): LLMTurn | null => {
    const e = event as {
      type?: string;
      message?: {
        id?: string;
        role?: string;
        model?: string;
        content?: unknown;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
      };
    };
    // Pi emits message_end for user prompts too — filter to assistant only,
    // mirroring the existing role guard at harness/pi/index.ts:434.
    if (e?.type !== 'message_end' || e.message?.role !== 'assistant') {
      return null;
    }
    const now = Date.now();
    const latencyMs = now - prevTurnAt;
    prevTurnAt = now;
    return {
      provider: 'anthropic',
      model: e.message.model ?? 'unknown',
      input: [...conversation],
      outputChoices: Array.isArray(e.message.content) ? e.message.content : [],
      inputTokens: e.message.usage?.input_tokens,
      outputTokens: e.message.usage?.output_tokens,
      cacheReadTokens: e.message.usage?.cache_read_input_tokens,
      cacheCreationTokens: e.message.usage?.cache_creation_input_tokens,
      latencyMs,
      generationId: e.message.id,
      isError: false,
    };
  };

  return {
    setInitialPrompt(prompt) {
      initialPrompt = prompt;
      // Reset conversation to the initial user turn — this is the only way
      // the initial prompt gets into `$ai_input` for the first generation,
      // since the SDK subprocess consumes it internally and doesn't echo it
      // on the return stream.
      conversation = [
        { role: 'user', content: [{ type: 'text', text: prompt }] },
      ];
      lastAssistantContent = undefined;
    },
    captureFromAnthropicSDKMessage(msg) {
      try {
        // User turns (tool_result blocks between assistant turns) accumulate
        // in the conversation so the next assistant generation carries the
        // full context the model actually saw.
        const m = msg as {
          type?: string;
          message?: { role?: string; content?: unknown };
          is_error?: boolean;
        };
        if (m?.type === 'user' && m.message) {
          conversation.push({
            role: 'user',
            content: m.message.content ?? [],
          });
        }
        const turn = anthropicAssistantTurn(msg);
        if (turn) {
          postGeneration(turn);
          // Push the assistant turn AFTER posting so the current generation's
          // $ai_input is the conversation as the model saw it (not including
          // its own response), and later turns include this one.
          conversation.push({
            role: 'assistant',
            content: turn.outputChoices,
          });
          lastAssistantContent = turn.outputChoices;
        }
        // Terminal: SDK emits a `result` message at end of run.
        if (m?.type === 'result') {
          sendTraceEnd({ isError: !!m.is_error });
        }
      } catch (err) {
        logToFile(
          `[aio-capture] anthropic compose failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    },
    captureFromPiMessageEndEvent(event) {
      try {
        // Pi's subscribe callback surfaces both user and assistant
        // message_end events. Accumulate user turns the same way as the
        // anthropic path so `$ai_input` matches the model's view.
        const e = event as {
          type?: string;
          message?: { role?: string; content?: unknown };
          willRetry?: boolean;
        };
        if (
          e?.type === 'message_end' &&
          e.message?.role === 'user' &&
          e.message
        ) {
          conversation.push({
            role: 'user',
            content: e.message.content ?? [],
          });
        }
        const turn = piAssistantTurn(event);
        if (turn) {
          postGeneration(turn);
          conversation.push({
            role: 'assistant',
            content: turn.outputChoices,
          });
          lastAssistantContent = turn.outputChoices;
        }
        // Terminal: pi emits `agent_end` when the session's prompt() resolves.
        if (e?.type === 'agent_end' && !e.willRetry) {
          sendTraceEnd({ isError: false });
        }
      } catch (err) {
        logToFile(
          `[aio-capture] pi compose failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    },
  };
}
