import { Sequence } from '@shared/constants';
import { analytics } from '@utils/analytics';
import {
  classifyStreamStallError,
  createStreamStallWatcher,
  DEFAULT_STREAM_SILENCE_MS,
  getActivePiSessions,
  STREAM_STALL_EVENT,
  type StreamStallWatcherOptions,
} from '../stream-stall';

vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn() },
}));
vi.mock('@utils/debug', () => ({ logToFile: vi.fn() }));

describe('classifyStreamStallError', () => {
  it.each([
    ['request deadline exceeded mid-stream', 'deadline_exceeded'],
    ['context deadline exceeded', 'deadline_exceeded'],
    ['UND_ERR_BODY_TIMEOUT', 'deadline_exceeded'],
    ['upstream closed the stream', 'upstream_closed'],
    ['stream ended unexpectedly', 'upstream_closed'],
    ['terminated', 'upstream_closed'],
    ['upstream connection lost', 'connection_reset'],
    ['read ECONNRESET', 'connection_reset'],
    ['socket hang up', 'connection_reset'],
  ] as const)('classifies "%s" as %s', (message, expected) => {
    expect(classifyStreamStallError(message)).toBe(expected);
  });

  it.each([
    undefined,
    '',
    '401 authentication_error',
    '429 rate limit exceeded',
    'invalid_request_error: bad schema',
    'session terminated by policy',
  ])('returns undefined for non-stall error %s', (message) => {
    expect(classifyStreamStallError(message)).toBeUndefined();
  });
});

describe('createStreamStallWatcher', () => {
  const watchers: Array<ReturnType<typeof createStreamStallWatcher>> = [];

  const createWatcher = (
    overrides: Partial<StreamStallWatcherOptions> = {},
  ) => {
    const watcher = createStreamStallWatcher({
      sequence: Sequence.orchestrator,
      model: 'openai/gpt-6.2-sol',
      effort: 'low',
      api: 'openai-responses',
      tag: 'pi-task',
      analyticsProperties: { task_type: 'logs', task_id: 'task-7' },
      ...overrides,
    });
    watchers.push(watcher);
    return watcher;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T22:00:00Z'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    while (watchers.length > 0) {
      watchers.pop()?.dispose();
    }
    vi.useRealTimers();
  });

  it('does not fire on healthy turns or slow tool execution after message_end', () => {
    const watcher = createWatcher();

    watcher.onEvent({ type: 'turn_start' });
    watcher.onEvent({ type: 'message_start', message: { role: 'assistant' } });
    vi.advanceTimersByTime(60_000);
    watcher.onEvent({ type: 'message_update' });
    vi.advanceTimersByTime(60_000);
    watcher.onEvent({
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'toolUse' },
    });

    // Long bash install between assistant turns must not trigger stream silence.
    vi.advanceTimersByTime(300_000);

    expect(analytics.wizardCapture).not.toHaveBeenCalled();
    watcher.dispose();
    expect(getActivePiSessions()).toBe(0);
  });

  it('emits silent at 120s and failed at 600s deadline error with full diagnostics', () => {
    const watcher = createWatcher();

    watcher.onEvent({ type: 'turn_start' });
    // User/toolResult messages must not reset or end the model wait.
    watcher.onEvent({ type: 'message_start', message: { role: 'user' } });
    watcher.onEvent({ type: 'message_end', message: { role: 'user' } });

    watcher.onEvent({ type: 'message_start', message: { role: 'assistant' } });
    vi.advanceTimersByTime(5_000);
    watcher.onEvent({ type: 'message_update' });
    watcher.onEvent({ type: 'message_update' });

    vi.advanceTimersByTime(DEFAULT_STREAM_SILENCE_MS);
    expect(analytics.wizardCapture).toHaveBeenCalledTimes(1);
    expect(analytics.wizardCapture).toHaveBeenLastCalledWith(
      STREAM_STALL_EVENT,
      expect.objectContaining({
        stage: 'silent',
        harness: 'pi',
        sequence: Sequence.orchestrator,
        model: 'openai/gpt-6.2-sol',
        effort: 'low',
        api: 'openai-responses',
        task_type: 'logs',
        task_id: 'task-7',
        turn_number: 1,
        stream_opened: true,
        chunks_received: 2,
        idle_ms: DEFAULT_STREAM_SILENCE_MS,
        turn_elapsed_ms: DEFAULT_STREAM_SILENCE_MS + 5_000,
        active_sessions: 1,
        turn_start_active_sessions: 1,
      }),
    );

    vi.advanceTimersByTime(480_000);
    watcher.onEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'request deadline exceeded mid-stream',
      },
    });
    watcher.onEvent({ type: 'agent_end', willRetry: false });

    expect(analytics.wizardCapture).toHaveBeenCalledTimes(2);
    expect(analytics.wizardCapture).toHaveBeenLastCalledWith(
      STREAM_STALL_EVENT,
      expect.objectContaining({
        stage: 'failed',
        error_kind: 'deadline_exceeded',
        error_message: 'request deadline exceeded mid-stream',
        stream_opened: true,
        chunks_received: 2,
        idle_ms: 600_000,
        turn_elapsed_ms: 605_000,
      }),
    );
  });

  it('emits silent with stream_opened=false when request hangs before first byte', () => {
    const watcher = createWatcher();
    watcher.onEvent({ type: 'turn_start' });
    vi.advanceTimersByTime(DEFAULT_STREAM_SILENCE_MS);

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      STREAM_STALL_EVENT,
      expect.objectContaining({
        stage: 'silent',
        stream_opened: false,
        chunks_received: 0,
      }),
    );
  });

  it('emits failed on mid-stream drops once agent_end confirms no retry, and ignores non-stall errors', () => {
    const watcher = createWatcher();

    watcher.onEvent({ type: 'turn_start' });
    vi.advanceTimersByTime(2_000);
    watcher.onEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: '401 authentication_error',
      },
    });
    watcher.onEvent({ type: 'agent_end', willRetry: false });
    expect(analytics.wizardCapture).not.toHaveBeenCalled();

    watcher.onEvent({ type: 'turn_start' });
    watcher.onEvent({ type: 'message_start', message: { role: 'assistant' } });
    vi.advanceTimersByTime(8_000);
    watcher.onEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'upstream closed the stream',
      },
    });
    // Held until agent_end reports whether Pi will retry.
    expect(analytics.wizardCapture).not.toHaveBeenCalled();

    watcher.onEvent({ type: 'agent_end', willRetry: false });
    expect(analytics.wizardCapture).toHaveBeenCalledTimes(1);
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      STREAM_STALL_EVENT,
      expect.objectContaining({
        stage: 'failed',
        turn_number: 2,
        error_kind: 'upstream_closed',
        error_message: 'upstream closed the stream',
      }),
    );
  });

  it('emits recovered when a silent turn completes, and still captures a later pre-turn_start transport error', () => {
    const watcher = createWatcher();
    watcher.onEvent({ type: 'turn_start' });
    vi.advanceTimersByTime(DEFAULT_STREAM_SILENCE_MS + 10_000);
    watcher.onEvent({
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'stop' },
    });

    // Follow-up continuation or remark prompt fails at the socket before turn_start.
    watcher.noteTransportError('read ECONNRESET');

    expect(analytics.wizardCapture).toHaveBeenCalledTimes(3);
    expect(analytics.wizardCapture).toHaveBeenNthCalledWith(
      1,
      STREAM_STALL_EVENT,
      expect.objectContaining({ stage: 'silent' }),
    );
    expect(analytics.wizardCapture).toHaveBeenNthCalledWith(
      2,
      STREAM_STALL_EVENT,
      expect.objectContaining({ stage: 'recovered' }),
    );
    expect(analytics.wizardCapture).toHaveBeenNthCalledWith(
      3,
      STREAM_STALL_EVENT,
      expect.objectContaining({
        stage: 'failed',
        error_kind: 'connection_reset',
        error_message: 'read ECONNRESET',
        idle_ms: 0,
        chunks_received: 0,
      }),
    );
  });

  it('emits aborted on stopReason aborted after silent without duplicating on cancelled dispose', () => {
    const watcher = createWatcher();
    watcher.onEvent({ type: 'turn_start' });
    vi.advanceTimersByTime(DEFAULT_STREAM_SILENCE_MS);
    watcher.onEvent({
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'aborted' },
    });
    watcher.dispose({ cancelled: true });

    expect(analytics.wizardCapture).toHaveBeenCalledTimes(2);
    expect(analytics.wizardCapture).toHaveBeenNthCalledWith(
      2,
      STREAM_STALL_EVENT,
      expect.objectContaining({ stage: 'aborted' }),
    );
  });

  it('emits aborted when cancelled during an active silent hang without double-emitting', () => {
    const watcher = createWatcher();
    watcher.onEvent({ type: 'turn_start' });
    vi.advanceTimersByTime(DEFAULT_STREAM_SILENCE_MS);
    watcher.dispose({ cancelled: true });
    watcher.dispose({ cancelled: true });

    expect(analytics.wizardCapture).toHaveBeenCalledTimes(2);
    expect(analytics.wizardCapture).toHaveBeenNthCalledWith(
      2,
      STREAM_STALL_EVENT,
      expect.objectContaining({ stage: 'aborted' }),
    );
    expect(getActivePiSessions()).toBe(0);
  });

  it('clears state on agent_end so a later cancelled dispose does not emit a false aborted event', () => {
    const watcher = createWatcher();
    watcher.onEvent({ type: 'turn_start' });
    vi.advanceTimersByTime(DEFAULT_STREAM_SILENCE_MS);
    watcher.onEvent({ type: 'agent_end' });
    watcher.dispose({ cancelled: true });

    expect(analytics.wizardCapture).toHaveBeenCalledTimes(1);
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      STREAM_STALL_EVENT,
      expect.objectContaining({ stage: 'silent' }),
    );
  });

  it('pauses silence detection during compaction and re-arms on compaction_end', () => {
    const watcher = createWatcher();
    watcher.onEvent({ type: 'turn_start' });
    vi.advanceTimersByTime(60_000);
    watcher.onEvent({ type: 'compaction_start' });

    // Compaction itself taking longer than threshold must not fire silent.
    vi.advanceTimersByTime(DEFAULT_STREAM_SILENCE_MS * 2);
    expect(analytics.wizardCapture).not.toHaveBeenCalled();

    // Resuming after compaction re-arms the silence timer for a subsequent hang.
    watcher.onEvent({ type: 'compaction_end', aborted: false });
    vi.advanceTimersByTime(DEFAULT_STREAM_SILENCE_MS);
    expect(analytics.wizardCapture).toHaveBeenCalledTimes(1);
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      STREAM_STALL_EVENT,
      expect.objectContaining({
        stage: 'silent',
        idle_ms: DEFAULT_STREAM_SILENCE_MS,
      }),
    );
  });

  it('clears paused state when compaction_end aborts', () => {
    const watcher = createWatcher();
    watcher.onEvent({ type: 'turn_start' });
    watcher.onEvent({ type: 'compaction_start' });
    watcher.onEvent({ type: 'compaction_end', aborted: true });
    vi.advanceTimersByTime(DEFAULT_STREAM_SILENCE_MS * 2);
    expect(analytics.wizardCapture).not.toHaveBeenCalled();
  });

  it('suppresses failed when Pi auto-retries a drop and recovers on the retry', () => {
    const watcher = createWatcher();
    watcher.onEvent({ type: 'turn_start' });
    watcher.onEvent({ type: 'message_start', message: { role: 'assistant' } });
    vi.advanceTimersByTime(8_000);
    watcher.onEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'upstream connection lost',
      },
    });
    watcher.onEvent({ type: 'agent_end', willRetry: true });
    watcher.onEvent({ type: 'auto_retry_start' });

    // Backoff sleep must not trigger silence or emit a premature failed event.
    vi.advanceTimersByTime(DEFAULT_STREAM_SILENCE_MS * 2);
    expect(analytics.wizardCapture).not.toHaveBeenCalled();

    // Retry attempt succeeds: Pi emits message_end then auto_retry_end(success: true).
    watcher.onEvent({ type: 'turn_start' });
    watcher.onEvent({ type: 'message_start', message: { role: 'assistant' } });
    vi.advanceTimersByTime(5_000);
    watcher.onEvent({
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'stop' },
    });
    watcher.onEvent({ type: 'auto_retry_end', success: true });
    watcher.onEvent({ type: 'agent_end', willRetry: false });

    expect(analytics.wizardCapture).not.toHaveBeenCalled();
  });

  it('emits recovered (not failed) when a silent turn drops and Pi recovers on retry', () => {
    const watcher = createWatcher();
    watcher.onEvent({ type: 'turn_start' });
    vi.advanceTimersByTime(DEFAULT_STREAM_SILENCE_MS);
    expect(analytics.wizardCapture).toHaveBeenCalledTimes(1);
    expect(analytics.wizardCapture).toHaveBeenLastCalledWith(
      STREAM_STALL_EVENT,
      expect.objectContaining({ stage: 'silent' }),
    );

    vi.advanceTimersByTime(30_000);
    watcher.onEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'socket hang up',
      },
    });
    watcher.onEvent({ type: 'agent_end', willRetry: true });
    watcher.onEvent({ type: 'auto_retry_start' });
    expect(analytics.wizardCapture).toHaveBeenCalledTimes(1);

    // Retry succeeds and closes the silent loop with recovered.
    watcher.onEvent({ type: 'turn_start' });
    watcher.onEvent({ type: 'message_start', message: { role: 'assistant' } });
    vi.advanceTimersByTime(5_000);
    watcher.onEvent({
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'stop' },
    });
    watcher.onEvent({ type: 'auto_retry_end', success: true });
    watcher.onEvent({ type: 'agent_end', willRetry: false });

    expect(analytics.wizardCapture).toHaveBeenCalledTimes(2);
    expect(analytics.wizardCapture).toHaveBeenNthCalledWith(
      2,
      STREAM_STALL_EVENT,
      expect.objectContaining({ stage: 'recovered' }),
    );
  });

  it('emits failed once when Pi exhausts retries on a mid-stream drop', () => {
    const watcher = createWatcher();

    // Attempt 1: retried by Pi.
    watcher.onEvent({ type: 'turn_start' });
    vi.advanceTimersByTime(8_000);
    watcher.onEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'upstream connection lost',
      },
    });
    watcher.onEvent({ type: 'agent_end', willRetry: true });
    watcher.onEvent({ type: 'auto_retry_start' });
    expect(analytics.wizardCapture).not.toHaveBeenCalled();

    // Attempt 2: final failure, Pi emits agent_end(willRetry: false) then auto_retry_end(success: false).
    watcher.onEvent({ type: 'turn_start' });
    vi.advanceTimersByTime(10_000);
    watcher.onEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'upstream connection lost',
      },
    });
    expect(analytics.wizardCapture).not.toHaveBeenCalled();

    watcher.onEvent({ type: 'agent_end', willRetry: false });
    watcher.onEvent({
      type: 'auto_retry_end',
      success: false,
      finalError: 'upstream connection lost',
    });

    expect(analytics.wizardCapture).toHaveBeenCalledTimes(1);
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      STREAM_STALL_EVENT,
      expect.objectContaining({
        stage: 'failed',
        turn_number: 2,
        error_kind: 'connection_reset',
        error_message: 'upstream connection lost',
        idle_ms: 10_000,
      }),
    );
  });

  it('emits failed on auto_retry_end(success: false) if retry backoff is cancelled before the next attempt', () => {
    const watcher = createWatcher();
    watcher.onEvent({ type: 'turn_start' });
    vi.advanceTimersByTime(8_000);
    watcher.onEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'upstream connection lost',
      },
    });
    watcher.onEvent({ type: 'agent_end', willRetry: true });
    watcher.onEvent({ type: 'auto_retry_start' });
    vi.advanceTimersByTime(20_000);
    watcher.onEvent({
      type: 'auto_retry_end',
      success: false,
      finalError: 'Retry cancelled',
    });
    watcher.dispose({ cancelled: true });

    expect(analytics.wizardCapture).toHaveBeenCalledTimes(1);
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      STREAM_STALL_EVENT,
      expect.objectContaining({
        stage: 'failed',
        error_kind: 'connection_reset',
        error_message: 'upstream connection lost',
        idle_ms: 8_000,
      }),
    );
  });

  it('tracks concurrent in-flight Pi sessions accurately across parallel tasks', () => {
    const sibling = createWatcher({
      analyticsProperties: { task_type: 'dashboard', task_id: 'task-6' },
    });
    const logs = createWatcher();

    expect(getActivePiSessions()).toBe(2);
    logs.onEvent({ type: 'turn_start' });
    sibling.dispose();
    expect(getActivePiSessions()).toBe(1);

    vi.advanceTimersByTime(DEFAULT_STREAM_SILENCE_MS);
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      STREAM_STALL_EVENT,
      expect.objectContaining({
        stage: 'silent',
        active_sessions: 1,
        turn_start_active_sessions: 2,
      }),
    );

    logs.dispose();
    expect(getActivePiSessions()).toBe(0);
  });

  it('redacts secrets in error_message before capturing', () => {
    const watcher = createWatcher();
    watcher.onEvent({ type: 'turn_start' });
    watcher.onEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage:
          'upstream closed the stream for phx_secret1234567890abcdef and sk-proj-0123456789abcdefghij',
      },
    });
    watcher.onEvent({ type: 'agent_end', willRetry: false });

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      STREAM_STALL_EVENT,
      expect.objectContaining({
        stage: 'failed',
        error_kind: 'upstream_closed',
        error_message: expect.not.stringMatching(
          /phx_secret1234567890abcdef|sk-proj-0123456789abcdefghij/,
        ),
      }),
    );
  });

  it('does not misclassify normal errors as stalls when silenceThresholdMs <= 0', () => {
    const watcher = createWatcher({ silenceThresholdMs: 0 });
    watcher.onEvent({ type: 'turn_start' });
    vi.advanceTimersByTime(5_000);
    watcher.onEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: '401 authentication_error',
      },
    });
    watcher.onEvent({ type: 'agent_end', willRetry: false });

    expect(analytics.wizardCapture).not.toHaveBeenCalled();
  });

  it('clears silence timer during retry backoff and handles thrown transport errors once', () => {
    const watcher = createWatcher();
    watcher.onEvent({ type: 'turn_start' });
    watcher.onEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: '429 rate limit exceeded',
      },
    });
    watcher.onEvent({ type: 'agent_end', willRetry: true });
    watcher.onEvent({ type: 'auto_retry_start' });
    vi.advanceTimersByTime(DEFAULT_STREAM_SILENCE_MS * 2);
    expect(analytics.wizardCapture).not.toHaveBeenCalled();

    watcher.noteTransportError('read ECONNRESET');
    watcher.noteTransportError('read ECONNRESET');
    expect(analytics.wizardCapture).toHaveBeenCalledTimes(1);
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      STREAM_STALL_EVENT,
      expect.objectContaining({
        stage: 'failed',
        error_kind: 'connection_reset',
        error_message: 'read ECONNRESET',
      }),
    );
  });
});
