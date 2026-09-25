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
  const gaveUp = (raw: string) => ({
    classification: 'WIZARD_API_ERROR',
    message: expect.stringMatching(
      new RegExp(`dropped mid-response.*\\(${raw}\\).*Try again`),
    ),
  });

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  interface Row {
    name: string;
    turns: object[];
    /** Math.random for every jitter draw; 0.5 is no jitter. */
    random?: number;
    /** Abort this far into the first backoff. */
    abortAfterMs?: number;
    /** When each prompt reached the session, in ms from the start. */
    prompted: number[];
    retries: number;
    failure?: { classification: string; message: unknown };
  }

  it.each<Row>([
    {
      name: 'one stream drop resumes and succeeds',
      turns: [upstreamClosed, fine],
      prompted: [0, 1000],
      retries: 1,
    },
    {
      name: 'a reset socket resumes',
      turns: [drop('read ECONNRESET'), fine],
      prompted: [0, 1000],
      retries: 1,
    },
    {
      name: 'jitter shortens the wait by up to 20%',
      turns: [upstreamClosed, upstreamClosed, fine],
      random: 0,
      prompted: [0, 800, 2400],
      retries: 2,
    },
    {
      name: 'jitter lengthens the wait by up to 20%',
      turns: [upstreamClosed, upstreamClosed, fine],
      random: 1,
      prompted: [0, 1200, 3600],
      retries: 2,
    },
    {
      name: 'drops beyond the limit give up with a clear message',
      turns: [upstreamClosed, upstreamClosed, upstreamClosed, fine],
      prompted: [0, 1000, 3000],
      retries: 2,
      failure: gaveUp('upstream closed the stream'),
    },
    // pi's own auto-retry already covers these, so the wizard adds none.
    ...['socket hang up', 'terminated'].map((message) => ({
      name: `a "${message}" drop is left to pi and reads clearly`,
      turns: [drop(message), fine],
      prompted: [0],
      retries: 0,
      failure: gaveUp(message),
    })),
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
  ])(
    '$name',
    async ({
      turns,
      random = 0.5,
      abortAfterMs,
      prompted,
      retries,
      failure,
    }) => {
      vi.spyOn(Math, 'random').mockReturnValue(random);
      const controller = new AbortController();
      const start = Date.now();
      const promptedAt: number[] = [];
      const prompts: string[] = [];
      // What the model saw last when each prompt went out.
      const lastBeforePrompt: unknown[] = [];
      const onStreamRetry = vi.fn();
      const agent = { state: { messages: [] as unknown[] } };
      const session = {
        agent,
        prompt: vi.fn((text: string) => {
          promptedAt.push(Date.now() - start);
          prompts.push(text);
          lastBeforePrompt.push(agent.state.messages.at(-1));
          const turn = turns.shift() ?? fine;
          agent.state.messages = [
            ...agent.state.messages,
            { role: 'user', text },
            turn,
          ];
          wrapped.noteAssistantTurn(turn);
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
      // Every resume goes out with the cut-off turn removed, as pi's retry does.
      for (const last of lastBeforePrompt.slice(1))
        expect(last).toEqual({ role: 'user', text: expect.any(String) });
      expect(onStreamRetry).toHaveBeenCalledTimes(retries);
      expect(refreshAuth).not.toHaveBeenCalled();
      if (failure) expect(wrapped.terminalFailure()).toMatchObject(failure);
      else if (abortAfterMs === undefined)
        expect(wrapped.terminalFailure()).toBeUndefined();
    },
  );
});
