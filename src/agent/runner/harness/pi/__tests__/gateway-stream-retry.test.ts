import { withGatewayRemint } from '../gateway';
import type { GatewayAuth } from '@agent/gateway-session';

describe('withGatewayRemint after a dropped model stream', () => {
  const drop = (errorMessage: string) => ({
    role: 'assistant',
    stopReason: 'error',
    errorMessage,
  });
  const upstreamClosed = drop('upstream closed the stream');
  const fine = { role: 'assistant', stopReason: 'stop' };
  const auth: GatewayAuth = {
    gatewayUrl: 'https://ai-gateway.us.posthog.com',
    token: 'phe_fresh',
    teamId: 42,
    refreshAtMs: Date.now() + 3600_000,
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  interface Row {
    name: string;
    turns: object[];
    /** Abort this far into the first backoff. */
    abortAfterMs?: number;
    /** When each prompt reached the session, in ms from the start. */
    prompted: number[];
    retries: number;
    failure?: { classification: string; message: string };
  }

  it.each<Row>([
    {
      name: 'one stream drop resumes and succeeds',
      turns: [upstreamClosed, fine],
      prompted: [0, 1000],
      retries: 1,
    },
    ...['read ECONNRESET', 'socket hang up', 'terminated'].map((message) => ({
      name: `a "${message}" drop resumes`,
      turns: [drop(message), fine],
      prompted: [0, 1000],
      retries: 1,
    })),
    {
      name: 'drops beyond the limit give up with the original failure',
      turns: [upstreamClosed, upstreamClosed, upstreamClosed, fine],
      prompted: [0, 1000, 3000],
      retries: 2,
      failure: {
        classification: 'WIZARD_API_ERROR',
        message: 'upstream closed the stream',
      },
    },
    {
      name: 'an abort during backoff stops',
      turns: [upstreamClosed, fine],
      abortAfterMs: 500,
      prompted: [0],
      retries: 1,
    },
    {
      name: 'a non-transient error does not retry',
      turns: [
        {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: 'bad request',
          diagnostics: [{ error: { code: 400 } }],
        },
        fine,
      ],
      prompted: [0],
      retries: 0,
      failure: { classification: 'WIZARD_API_ERROR', message: 'bad request' },
    },
  ])('$name', async ({ turns, abortAfterMs, prompted, retries, failure }) => {
    const controller = new AbortController();
    const start = Date.now();
    const promptedAt: number[] = [];
    const prompts: string[] = [];
    const onStreamRetry = vi.fn();
    const session = {
      prompt: vi.fn((text: string) => {
        promptedAt.push(Date.now() - start);
        prompts.push(text);
        wrapped.noteAssistantTurn(turns.shift() ?? fine);
        return Promise.resolve();
      }),
    };
    const refreshAuth = vi.fn();
    const wrapped = withGatewayRemint({
      signal: controller.signal,
      session,
      registry: { registerProvider: vi.fn() },
      auth,
      refreshAuth,
      providerInputs: (a) => ({
        gatewayUrl: a.gatewayUrl,
        accessToken: a.token,
        wizardMetadata: {},
        wizardFlags: {},
        modelId: 'openai/gpt-5.6-terra',
      }),
      continueText: 'continue',
      onStreamRetry,
    });

    const run = wrapped.prompt('do it');
    if (abortAfterMs === undefined) {
      await vi.runAllTimersAsync();
    } else {
      // No more time passes: the abort alone has to end the wait.
      await vi.advanceTimersByTimeAsync(abortAfterMs);
      controller.abort();
    }
    await run;

    // The resume continues the conversation; the task prompt is sent once.
    expect(prompts).toEqual([
      'do it',
      ...prompted.slice(1).map(() => 'continue'),
    ]);
    expect(promptedAt).toEqual(prompted);
    expect(onStreamRetry).toHaveBeenCalledTimes(retries);
    expect(refreshAuth).not.toHaveBeenCalled();
    if (failure) expect(wrapped.terminalFailure()).toMatchObject(failure);
    else if (abortAfterMs === undefined)
      expect(wrapped.terminalFailure()).toBeUndefined();
  });
});
