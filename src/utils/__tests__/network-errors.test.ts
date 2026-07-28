import {
  NetworkError,
  describeNetworkError,
  hostLabel,
  isRetryableNetworkError,
  networkErrorFor,
} from '@utils/network-errors';

/**
 * The shape axios rethrows when Node's happy-eyeballs connect fails: an
 * AxiosError whose own `message` is the empty string, because
 * `AxiosError.from` copies it off the `AggregateError` that
 * `internalConnectMultiple` built without one. `errors` and `cause` carry the
 * only usable detail. Verified against a live failure (two addresses, both
 * refusing) rather than guessed.
 */
function happyEyeballsFailure({
  code = 'ECONNREFUSED',
  detail = 'connect ECONNREFUSED 127.0.0.1:1',
  wrapperCode = true,
}: { code?: string; detail?: string; wrapperCode?: boolean } = {}) {
  const inner = Object.assign(new Error(detail), { code });
  const aggregate = Object.assign(new AggregateError([inner]), {
    message: '',
    ...(wrapperCode ? { code } : {}),
  });
  return Object.assign(new Error(''), {
    name: 'AggregateError',
    isAxiosError: true,
    ...(wrapperCode ? { code } : {}),
    errors: [inner],
    cause: aggregate,
  });
}

describe('describeNetworkError', () => {
  it('unwraps the empty-message AggregateError axios rethrows', () => {
    const error = happyEyeballsFailure();

    expect(error.message).toBe(''); // the message callers used to print
    expect(describeNetworkError(error)).toEqual({
      code: 'ECONNREFUSED',
      message: 'connect ECONNREFUSED 127.0.0.1:1',
    });
  });

  it('finds the code on errors[0] when the wrapper has none', () => {
    const error = happyEyeballsFailure({
      code: 'ETIMEDOUT',
      detail: 'connect ETIMEDOUT 10.0.0.1:443',
      wrapperCode: false,
    });

    expect(describeNetworkError(error)).toEqual({
      code: 'ETIMEDOUT',
      message: 'connect ETIMEDOUT 10.0.0.1:443',
    });
  });

  it('keeps a plain error message and code as-is', () => {
    const error = Object.assign(
      new Error('getaddrinfo ENOTFOUND us.posthog.com'),
      {
        code: 'ENOTFOUND',
      },
    );

    expect(describeNetworkError(error)).toEqual({
      code: 'ENOTFOUND',
      message: 'getaddrinfo ENOTFOUND us.posthog.com',
    });
  });

  it('passes a codeless application error straight through', () => {
    // The signup flow keys its fall-back-to-login branch off this message.
    const message =
      'This email is already associated with a PostHog account. Please use the login flow instead.';

    expect(describeNetworkError(new Error(message))).toEqual({
      code: undefined,
      message,
    });
  });

  it('follows a cause chain for the message', () => {
    const error = new Error('', { cause: new Error('socket hang up') });

    expect(describeNetworkError(error).message).toBe('socket hang up');
  });

  it('survives a self-referential cause', () => {
    const error: Error & { cause?: unknown } = new Error('');
    error.cause = error;

    expect(describeNetworkError(error)).toEqual({
      code: undefined,
      message: '',
    });
  });

  it('returns nothing usable for non-error values', () => {
    expect(describeNetworkError('boom')).toEqual({
      code: undefined,
      message: '',
    });
    expect(describeNetworkError(undefined)).toEqual({
      code: undefined,
      message: '',
    });
  });
});

describe('isRetryableNetworkError', () => {
  it('retries a happy-eyeballs connect failure', () => {
    expect(isRetryableNetworkError(happyEyeballsFailure())).toBe(true);
  });

  it('retries transient errno codes', () => {
    for (const code of ['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN']) {
      expect(
        isRetryableNetworkError(Object.assign(new Error(code), { code })),
      ).toBe(true);
    }
  });

  it('does not retry once PostHog has responded', () => {
    // A 500 reached us: the status is the caller's to interpret, and re-POSTing
    // a request the server already processed could provision twice.
    const httpError = Object.assign(
      new Error('Request failed with status code 500'),
      {
        code: 'ERR_BAD_RESPONSE',
        response: { status: 500 },
      },
    );

    expect(isRetryableNetworkError(httpError)).toBe(false);
  });

  it('does not retry a response-bearing error that also aggregates', () => {
    const error = Object.assign(happyEyeballsFailure(), {
      response: { status: 502 },
    });

    expect(isRetryableNetworkError(error)).toBe(false);
  });

  it('does not retry application errors', () => {
    expect(
      isRetryableNetworkError(new Error('This email is already associated')),
    ).toBe(false);
    expect(isRetryableNetworkError('nope')).toBe(false);
  });
});

describe('networkErrorFor', () => {
  it('names the host and the remediation instead of printing nothing', () => {
    const error = networkErrorFor(
      happyEyeballsFailure({
        code: 'ENOTFOUND',
        detail: 'getaddrinfo ENOTFOUND us.posthog.com',
      }),
      'https://us.posthog.com/api/agentic/provisioning/account_requests',
      3,
    );

    expect(error).toBeInstanceOf(NetworkError);
    expect(error.host).toBe('us.posthog.com');
    expect(error.code).toBe('ENOTFOUND');
    expect(error.message).toBe(
      "Couldn't reach us.posthog.com — check your network, VPN, or proxy and try again. " +
        '(getaddrinfo ENOTFOUND us.posthog.com after 3 attempts)',
    );
  });

  it('prepends the code when the message does not already carry it', () => {
    const error = networkErrorFor(
      Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
      'https://eu.posthog.com/api/agentic/oauth/token',
    );

    expect(error.message).toContain("Couldn't reach eu.posthog.com");
    expect(error.message).toContain('(ECONNRESET: socket hang up)');
  });

  it('stays legible when the error says nothing at all', () => {
    const error = networkErrorFor(new Error(''), 'https://us.posthog.com/x');

    expect(error.message).toBe(
      "Couldn't reach us.posthog.com — check your network, VPN, or proxy and try again. " +
        '(no detail from the network layer)',
    );
  });

  it('keeps the original error as the cause', () => {
    const original = happyEyeballsFailure();

    expect(networkErrorFor(original, 'https://us.posthog.com/x').cause).toBe(
      original,
    );
  });
});

describe('hostLabel', () => {
  it('reduces a URL to its host', () => {
    expect(hostLabel('https://us.posthog.com/api/agentic')).toBe(
      'us.posthog.com',
    );
    expect(hostLabel('http://localhost:8010/api')).toBe('localhost:8010');
  });

  it('falls back to the raw string when it is not a URL', () => {
    expect(hostLabel('not a url')).toBe('not a url');
  });
});
