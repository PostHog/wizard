/**
 * Stream idle watchdog: a silent model stream must end as an error pi retries,
 * and a healthy or cancelled stream must pass through untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAssistantMessageEventStream,
  isRetryableAssistantError,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import { analytics } from '@utils/analytics';
import { withStreamIdleTimeout, type StreamSimple } from '../stream-watchdog';

vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn() },
}));
vi.mock('@utils/debug');

const IDLE_MS = 1_000;
const model = {
  id: 'openai/gpt-test',
  api: 'openai-responses',
  provider: 'posthog-gateway',
} as Parameters<StreamSimple>[0];
const context = { messages: [] } as unknown as Parameters<StreamSimple>[1];

function message(stopReason: AssistantMessage['stopReason']): AssistantMessage {
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
    stopReason,
    timestamp: Date.now(),
  };
}

/** A stream function whose inner stream the test drives by hand. */
function controlled() {
  let inner!: AssistantMessageEventStream;
  let options: SimpleStreamOptions | undefined;
  const stream: StreamSimple = (_model, _context, opts) => {
    options = opts;
    inner = createAssistantMessageEventStream();
    return inner;
  };
  return {
    stream,
    inner: () => inner,
    innerSignal: () => options?.signal,
  };
}

describe('withStreamIdleTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('passes a healthy stream through unchanged', async () => {
    const fake = controlled();
    const out = withStreamIdleTimeout(fake.stream, IDLE_MS)(model, context);
    fake.inner().push({ type: 'start', partial: message('pending') });
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    fake
      .inner()
      .push({ type: 'done', reason: 'stop', message: message('stop') });
    fake.inner().end();

    const result = await out.result();
    expect(result.stopReason).toBe('stop');
    expect(fake.innerSignal()?.aborted).toBe(false);
    expect(analytics.wizardCapture).not.toHaveBeenCalled();
  });

  it('ends a silent stream as a retryable timeout and aborts the request', async () => {
    const fake = controlled();
    const out = withStreamIdleTimeout(fake.stream, IDLE_MS)(model, context);
    fake.inner().push({ type: 'start', partial: message('pending') });
    await vi.advanceTimersByTimeAsync(IDLE_MS);

    const result = await out.result();
    expect(result.stopReason).toBe('error');
    expect(result.errorMessage).toMatch(/timed out/);
    expect(isRetryableAssistantError(result)).toBe(true);
    expect(fake.innerSignal()?.aborted).toBe(true);
    expect(analytics.wizardCapture).toHaveBeenCalledWith('llm stream stalled', {
      model: model.id,
      idle_timeout_ms: IDLE_MS,
      events_received: 1,
    });
  });

  it('times out a request that never sends a first event', async () => {
    const fake = controlled();
    const out = withStreamIdleTimeout(fake.stream, IDLE_MS)(model, context);
    await vi.advanceTimersByTimeAsync(IDLE_MS);

    const result = await out.result();
    expect(isRetryableAssistantError(result)).toBe(true);
  });

  it('forwards a caller cancel to the request', () => {
    const fake = controlled();
    const caller = new AbortController();
    withStreamIdleTimeout(fake.stream, IDLE_MS)(model, context, {
      signal: caller.signal,
    });
    caller.abort();
    expect(fake.innerSignal()?.aborted).toBe(true);
  });

  it('turns a stream that ends without a final event into a retryable error', async () => {
    const fake = controlled();
    const out = withStreamIdleTimeout(fake.stream, IDLE_MS)(model, context);
    fake.inner().push({ type: 'start', partial: message('pending') });
    fake.inner().end();

    const result = await out.result();
    expect(isRetryableAssistantError(result)).toBe(true);
  });
});
