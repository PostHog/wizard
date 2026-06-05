/**
 * Minimal Anthropic Messages API client for the harness runner.
 *
 * Speaks the Messages *streaming* protocol directly to the PostHog LLM gateway
 * (which proxies Anthropic / falls back to Bedrock), replacing the transport
 * the SDK's bundled cli.js owns today. Deliberately small: one streaming POST
 * to `/v1/messages`, SSE parsing, and assembly of a single assistant turn
 * (text + tool_use blocks), its stop reason, and usage. It carries no wizard
 * knowledge — the loop, headers, and model selection live in harness-runner.ts.
 */

export interface MessagesTextBlock {
  type: 'text';
  text: string;
}

export interface MessagesToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export type MessagesContentBlock = MessagesTextBlock | MessagesToolUseBlock;

export interface MessagesUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/** A single assembled assistant turn. */
export interface MessagesResponse {
  content: MessagesContentBlock[];
  stopReason: string | null;
  usage: MessagesUsage;
}

/** A turn in the conversation, in Anthropic Messages shape. */
export interface MessagesTurn {
  role: 'user' | 'assistant';
  content: unknown;
}

export interface MessagesRequest {
  model: string;
  system?: string;
  messages: MessagesTurn[];
  tools?: unknown[];
  maxTokens: number;
}

export interface MessagesStreamHandlers {
  /** Incremental assistant-text delta, emitted as it streams in. */
  onTextDelta?(text: string): void;
}

export interface StreamMessagesOptions {
  /** Gateway base URL, e.g. https://gateway.us.posthog.com/wizard */
  baseUrl: string;
  /** PostHog API key, sent as a Bearer token. */
  authToken: string;
  /** Extra HTTP headers (custom metadata, flags, Bedrock fallback). */
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/** Anthropic SSE event payloads we care about (others are ignored). */
interface StreamEvent {
  type: string;
  index?: number;
  content_block?: { type: string; id?: string; name?: string };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string | null;
  };
  usage?: MessagesUsage;
  message?: { usage?: MessagesUsage };
  error?: { type?: string; message?: string };
}

/** Mutable accumulator for one in-flight content block. */
interface BlockAccumulator {
  type: 'text' | 'tool_use';
  text: string;
  id?: string;
  name?: string;
  json: string;
}

class MessagesApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'MessagesApiError';
  }
}

export { MessagesApiError };

const ANTHROPIC_VERSION = '2023-06-01';

/**
 * POST a streaming Messages request and assemble the assistant turn.
 *
 * Resolves once the stream completes (`message_stop`); rejects on a transport
 * error, a non-2xx status, or an SSE `error` event. Text deltas are forwarded
 * to `handlers.onTextDelta` as they arrive.
 */
export async function streamMessages(
  request: MessagesRequest,
  options: StreamMessagesOptions,
  handlers: MessagesStreamHandlers = {},
): Promise<MessagesResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;

  const body = JSON.stringify({
    model: request.model,
    system: request.system,
    messages: request.messages,
    tools: request.tools,
    max_tokens: request.maxTokens,
    stream: true,
  });

  const response = await fetchImpl(
    `${trimTrailingSlash(options.baseUrl)}/v1/messages`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        'anthropic-version': ANTHROPIC_VERSION,
        authorization: `Bearer ${options.authToken}`,
        ...options.headers,
      },
      body,
      signal: options.signal,
    },
  );

  if (!response.ok) {
    const detail = await safeReadText(response);
    throw new MessagesApiError(
      `Messages request failed: ${response.status} ${response.statusText}${
        detail ? ` — ${detail}` : ''
      }`,
      response.status,
    );
  }
  if (!response.body) {
    throw new MessagesApiError('Messages response had no body');
  }

  return assembleStream(streamSSE(response.body), handlers);
}

/**
 * Assemble a stream of parsed SSE events into a single assistant turn.
 * Exported for unit tests — feed it events directly, no network needed.
 */
export async function assembleStream(
  events: AsyncIterable<StreamEvent>,
  handlers: MessagesStreamHandlers = {},
): Promise<MessagesResponse> {
  const blocks = new Map<number, BlockAccumulator>();
  let stopReason: string | null = null;
  let usage: MessagesUsage = {};

  for await (const event of events) {
    switch (event.type) {
      case 'message_start':
        if (event.message?.usage) usage = { ...usage, ...event.message.usage };
        break;
      case 'content_block_start': {
        const idx = event.index ?? blocks.size;
        const cb = event.content_block;
        blocks.set(idx, {
          type: cb?.type === 'tool_use' ? 'tool_use' : 'text',
          text: '',
          id: cb?.id,
          name: cb?.name,
          json: '',
        });
        break;
      }
      case 'content_block_delta': {
        const idx = event.index ?? 0;
        const acc = blocks.get(idx);
        if (!acc) break;
        if (event.delta?.type === 'text_delta' && event.delta.text) {
          acc.text += event.delta.text;
          handlers.onTextDelta?.(event.delta.text);
        } else if (
          event.delta?.type === 'input_json_delta' &&
          typeof event.delta.partial_json === 'string'
        ) {
          acc.json += event.delta.partial_json;
        }
        break;
      }
      case 'message_delta':
        if (event.delta?.stop_reason !== undefined) {
          stopReason = event.delta.stop_reason;
        }
        if (event.usage) usage = { ...usage, ...event.usage };
        break;
      case 'error':
        throw new MessagesApiError(
          event.error?.message ?? 'Messages stream error',
        );
      // content_block_stop / message_stop / ping: nothing to accumulate.
      default:
        break;
    }
  }

  const content: MessagesContentBlock[] = Array.from(blocks.entries())
    .sort(([a], [b]) => a - b)
    .map(([, acc]) =>
      acc.type === 'tool_use'
        ? {
            type: 'tool_use' as const,
            id: acc.id ?? '',
            name: acc.name ?? '',
            input: acc.json ? safeParseJson(acc.json) : {},
          }
        : { type: 'text' as const, text: acc.text },
    );

  return { content, stopReason, usage };
}

/**
 * Parse a fetch Response body (SSE byte stream) into Anthropic stream events.
 * Splits on blank lines and reads the `data:` payload of each event.
 */
async function* streamSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = parseSSEEvent(rawEvent);
        if (event) yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Parse one SSE event block ("data: {...}" lines) into a StreamEvent. */
function parseSSEEvent(raw: string): StreamEvent | null {
  const dataLines = raw
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim());
  if (dataLines.length === 0) return null;
  const data = dataLines.join('');
  if (!data || data === '[DONE]') return null;
  try {
    return JSON.parse(data) as StreamEvent;
  } catch {
    return null;
  }
}

function safeParseJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '';
  }
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
