import { createAioCapture } from '@lib/agent/aio-capture';

const RUN_TAGS = {
  program_id: 'posthog-integration',
  integration: 'nextjs',
  run_id: 'run-abc',
  build: 'dev',
  skill_id: 'foo',
};

const BASE_ARGS = {
  enabled: true,
  projectApiKey: 'phc_test',
  apiHost: 'https://us.i.posthog.com',
  runTags: RUN_TAGS,
};

/** Realistic anthropic SDK assistant message. */
function anthropicAssistant(
  overrides: Partial<{
    id: string;
    model: string;
    content: unknown[];
    usage: Record<string, number>;
  }> = {},
): unknown {
  return {
    type: 'assistant',
    message: {
      id: overrides.id ?? 'msg_01',
      model: overrides.model ?? 'claude-sonnet-4-5',
      content: overrides.content ?? [{ type: 'text', text: 'hi' }],
      usage: overrides.usage ?? {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 10,
      },
    },
  };
}

/** Realistic pi message_end event. */
function piMessageEnd(overrides: Partial<{ role: string }> = {}): unknown {
  return {
    type: 'message_end',
    message: {
      id: 'pi_01',
      role: overrides.role ?? 'assistant',
      model: 'claude-sonnet-4-5',
      content: [{ type: 'text', text: 'ok' }],
      usage: {
        input_tokens: 42,
        output_tokens: 7,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  };
}

/**
 * Waits one microtask tick so the fire-and-forget POST inside captureFrom*
 * gets a chance to call the mocked fetch. The module returns synchronously,
 * so we can't await its result directly.
 */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('createAioCapture', () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
  });

  afterAll(() => {
    (global as unknown as { fetch: unknown }).fetch = originalFetch;
  });

  describe('no-op behavior', () => {
    it('does not POST when enabled is false', async () => {
      const capture = createAioCapture({ ...BASE_ARGS, enabled: false });
      capture.captureFromAnthropicSDKMessage(anthropicAssistant());
      capture.captureFromPiMessageEndEvent(piMessageEnd());
      await flushMicrotasks();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not POST when projectApiKey is empty', async () => {
      const capture = createAioCapture({ ...BASE_ARGS, projectApiKey: '' });
      capture.captureFromAnthropicSDKMessage(anthropicAssistant());
      await flushMicrotasks();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not POST when apiHost is empty', async () => {
      const capture = createAioCapture({ ...BASE_ARGS, apiHost: '' });
      capture.captureFromAnthropicSDKMessage(anthropicAssistant());
      await flushMicrotasks();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('anthropic transform', () => {
    it('POSTs a $ai_generation event with the right shape', async () => {
      const capture = createAioCapture(BASE_ARGS);
      capture.captureFromAnthropicSDKMessage(anthropicAssistant());
      await flushMicrotasks();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [
        string,
        { method: string; headers: Record<string, string>; body: string },
      ];
      expect(url).toBe('https://us.i.posthog.com/capture/');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(init.body);
      expect(body.api_key).toBe('phc_test');
      expect(body.event).toBe('$ai_generation');
      expect(body.distinct_id).toMatch(/^wizard-cli-/);
      expect(body.properties.$ai_provider).toBe('anthropic');
      expect(body.properties.$ai_model).toBe('claude-sonnet-4-5');
      expect(body.properties.$ai_input_tokens).toBe(100);
      expect(body.properties.$ai_output_tokens).toBe(20);
      expect(body.properties.$ai_cache_read_input_tokens).toBe(50);
      expect(body.properties.$ai_cache_creation_input_tokens).toBe(10);
      expect(body.properties.$ai_generation_id).toBe('msg_01');
      expect(body.properties.$ai_is_error).toBe(false);
      expect(body.properties.$ai_trace_id).toBe('run-abc');
      expect(body.properties.program_id).toBe('posthog-integration');
      expect(body.properties.integration).toBe('nextjs');
      expect(body.properties.build).toBe('dev');
      expect(body.properties.skill_id).toBe('foo');
    });

    it('skips non-assistant, non-terminal SDK messages', async () => {
      const capture = createAioCapture(BASE_ARGS);
      capture.captureFromAnthropicSDKMessage({ type: 'user' });
      capture.captureFromAnthropicSDKMessage({ type: 'system' });
      await flushMicrotasks();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('tolerates missing usage — fills token fields with 0', async () => {
      const capture = createAioCapture(BASE_ARGS);
      capture.captureFromAnthropicSDKMessage({
        type: 'assistant',
        message: { id: 'x', model: 'm', content: [] },
      });
      await flushMicrotasks();
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.properties.$ai_input_tokens).toBe(0);
      expect(body.properties.$ai_output_tokens).toBe(0);
    });
  });

  describe('pi transform', () => {
    it('POSTs a $ai_generation for assistant message_end events', async () => {
      const capture = createAioCapture(BASE_ARGS);
      capture.captureFromPiMessageEndEvent(piMessageEnd());
      await flushMicrotasks();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.event).toBe('$ai_generation');
      expect(body.properties.$ai_model).toBe('claude-sonnet-4-5');
      expect(body.properties.$ai_input_tokens).toBe(42);
      expect(body.properties.$ai_generation_id).toBe('pi_01');
    });

    it('skips message_end events for non-assistant roles', async () => {
      const capture = createAioCapture(BASE_ARGS);
      capture.captureFromPiMessageEndEvent(piMessageEnd({ role: 'user' }));
      capture.captureFromPiMessageEndEvent(piMessageEnd({ role: 'system' }));
      await flushMicrotasks();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('skips non-terminal pi events that are not message_end', async () => {
      const capture = createAioCapture(BASE_ARGS);
      capture.captureFromPiMessageEndEvent({
        type: 'tool_execution_start',
        toolName: 'read',
      });
      capture.captureFromPiMessageEndEvent({
        type: 'tool_execution_end',
        toolName: 'read',
      });
      await flushMicrotasks();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('conversation tracking', () => {
    it('$ai_input is empty when no initial prompt was set', async () => {
      const capture = createAioCapture(BASE_ARGS);
      capture.captureFromAnthropicSDKMessage(anthropicAssistant());
      await flushMicrotasks();
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.properties.$ai_input).toEqual([]);
    });

    it('$ai_input carries the initial prompt on the first generation', async () => {
      const capture = createAioCapture(BASE_ARGS);
      capture.setInitialPrompt('integrate posthog into next-js app');
      capture.captureFromAnthropicSDKMessage(anthropicAssistant());
      await flushMicrotasks();
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.properties.$ai_input).toEqual([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'integrate posthog into next-js app' },
          ],
        },
      ]);
    });

    it('accumulates anthropic user turns and prior assistant turns into $ai_input', async () => {
      const capture = createAioCapture(BASE_ARGS);
      capture.setInitialPrompt('start');
      // First assistant turn sees only the initial prompt.
      capture.captureFromAnthropicSDKMessage(
        anthropicAssistant({
          id: 'msg_1',
          content: [{ type: 'tool_use', id: 'tu_1', name: 'read', input: {} }],
        }),
      );
      // Tool result comes back as a user SDK message.
      capture.captureFromAnthropicSDKMessage({
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', content: 'file body' },
          ],
        },
      });
      // Second assistant turn — should see initial prompt + first assistant + tool_result.
      capture.captureFromAnthropicSDKMessage(
        anthropicAssistant({
          id: 'msg_2',
          content: [{ type: 'text', text: 'done' }],
        }),
      );
      await flushMicrotasks();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const second = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(second.properties.$ai_input).toEqual([
        {
          role: 'user',
          content: [{ type: 'text', text: 'start' }],
        },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu_1', name: 'read', input: {} }],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', content: 'file body' },
          ],
        },
      ]);
    });

    it('accumulates pi user message_end events into $ai_input', async () => {
      const capture = createAioCapture(BASE_ARGS);
      capture.setInitialPrompt('start');
      // Pi surfaces both roles on message_end.
      capture.captureFromPiMessageEndEvent({
        type: 'message_end',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'tool returned foo' }],
        },
      });
      capture.captureFromPiMessageEndEvent(piMessageEnd());
      await flushMicrotasks();

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.properties.$ai_input).toEqual([
        {
          role: 'user',
          content: [{ type: 'text', text: 'start' }],
        },
        {
          role: 'user',
          content: [{ type: 'text', text: 'tool returned foo' }],
        },
      ]);
    });

    it('setInitialPrompt resets conversation state', async () => {
      const capture = createAioCapture(BASE_ARGS);
      capture.setInitialPrompt('first run');
      capture.captureFromAnthropicSDKMessage(anthropicAssistant({ id: 'a1' }));
      // Second setInitialPrompt should wipe prior conversation.
      capture.setInitialPrompt('second run');
      capture.captureFromAnthropicSDKMessage(anthropicAssistant({ id: 'a2' }));
      await flushMicrotasks();

      const second = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(second.properties.$ai_input).toEqual([
        {
          role: 'user',
          content: [{ type: 'text', text: 'second run' }],
        },
      ]);
    });
  });

  describe('trace-end', () => {
    it('emits $ai_trace when anthropic result message arrives', async () => {
      const capture = createAioCapture(BASE_ARGS);
      capture.setInitialPrompt('start');
      capture.captureFromAnthropicSDKMessage(
        anthropicAssistant({
          id: 'msg_1',
          content: [{ type: 'text', text: 'hello' }],
        }),
      );
      capture.captureFromAnthropicSDKMessage({
        type: 'result',
        subtype: 'success',
        is_error: false,
      });
      await flushMicrotasks();

      // First POST is the generation, second is the trace.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const traceBody = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(traceBody.event).toBe('$ai_trace');
      expect(traceBody.properties.$ai_trace_id).toBe('run-abc');
      expect(traceBody.properties.$ai_span_name).toBe('posthog-integration');
      expect(traceBody.properties.$ai_is_error).toBe(false);
      expect(typeof traceBody.properties.$ai_latency).toBe('number');
      // Trace-level Conversation view: initial prompt as input, last
      // assistant content as output.
      expect(traceBody.properties.$ai_input_state).toEqual([
        {
          role: 'user',
          content: [{ type: 'text', text: 'start' }],
        },
      ]);
      expect(traceBody.properties.$ai_output_state).toEqual([
        { type: 'text', text: 'hello' },
      ]);
    });

    it('$ai_input_state is empty when no initial prompt was set', async () => {
      const capture = createAioCapture(BASE_ARGS);
      capture.captureFromAnthropicSDKMessage({
        type: 'result',
        is_error: false,
      });
      await flushMicrotasks();
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.properties.$ai_input_state).toEqual([]);
      expect(body.properties.$ai_output_state).toEqual([]);
    });

    it('emits $ai_trace with is_error=true when result is_error is set', async () => {
      const capture = createAioCapture(BASE_ARGS);
      capture.captureFromAnthropicSDKMessage({
        type: 'result',
        is_error: true,
      });
      await flushMicrotasks();

      const traceBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(traceBody.event).toBe('$ai_trace');
      expect(traceBody.properties.$ai_is_error).toBe(true);
    });

    it('emits $ai_trace when pi agent_end arrives (willRetry=false)', async () => {
      const capture = createAioCapture(BASE_ARGS);
      capture.captureFromPiMessageEndEvent({
        type: 'agent_end',
        willRetry: false,
      });
      await flushMicrotasks();

      const traceBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(traceBody.event).toBe('$ai_trace');
      expect(traceBody.properties.$ai_span_name).toBe('posthog-integration');
    });

    it('does not emit $ai_trace on pi agent_end with willRetry=true', async () => {
      const capture = createAioCapture(BASE_ARGS);
      capture.captureFromPiMessageEndEvent({
        type: 'agent_end',
        willRetry: true,
      });
      await flushMicrotasks();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('emits $ai_trace at most once even across multiple terminals', async () => {
      const capture = createAioCapture(BASE_ARGS);
      capture.captureFromAnthropicSDKMessage({
        type: 'result',
        is_error: false,
      });
      capture.captureFromAnthropicSDKMessage({
        type: 'result',
        is_error: false,
      });
      capture.captureFromPiMessageEndEvent({
        type: 'agent_end',
        willRetry: false,
      });
      await flushMicrotasks();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.event).toBe('$ai_trace');
    });

    it('falls back to "wizard-run" when program_id is missing from runTags', async () => {
      const capture = createAioCapture({
        ...BASE_ARGS,
        runTags: { run_id: 'run-abc', integration: 'nextjs', build: 'dev' },
      });
      capture.captureFromAnthropicSDKMessage({
        type: 'result',
        is_error: false,
      });
      await flushMicrotasks();
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.properties.$ai_span_name).toBe('wizard-run');
    });
  });

  describe('failure isolation', () => {
    it('swallows POST rejections without throwing', async () => {
      fetchMock.mockImplementation(() => Promise.reject(new Error('boom')));
      const capture = createAioCapture(BASE_ARGS);
      // Must not throw — synchronous return, promise rejects internally.
      expect(() =>
        capture.captureFromAnthropicSDKMessage(anthropicAssistant()),
      ).not.toThrow();
      await flushMicrotasks();
      // Fetch was still attempted.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('swallows non-2xx responses without throwing', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(new Response('nope', { status: 500 })),
      );
      const capture = createAioCapture(BASE_ARGS);
      expect(() =>
        capture.captureFromAnthropicSDKMessage(anthropicAssistant()),
      ).not.toThrow();
      await flushMicrotasks();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('swallows malformed messages without throwing', async () => {
      const capture = createAioCapture(BASE_ARGS);
      // No `message` field at all — the transform reads message?.content etc.
      expect(() =>
        capture.captureFromAnthropicSDKMessage({ type: 'assistant' }),
      ).not.toThrow();
      // null / undefined / non-object
      expect(() => capture.captureFromAnthropicSDKMessage(null)).not.toThrow();
      expect(() =>
        capture.captureFromPiMessageEndEvent(undefined),
      ).not.toThrow();
      await flushMicrotasks();
    });
  });
});
