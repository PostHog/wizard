import {
  hostServesCaptureV1,
  isCloudApiHost,
  probeV1Routes,
  V1_ROUTES,
} from '@shared/host-v1-probe';

const REFUSAL = '{"error":"missing_authorization","message":"..."}';
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

/** A fetch stub answering per route; a thrown value models no answer. */
const fetchFor = (answers: Record<string, Response | Error>) =>
  vi.fn((url: string) => {
    const route = V1_ROUTES.find((r) => url.endsWith(r)) ?? url;
    const answer = answers[route];
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer);
  }) as unknown as typeof fetch;
const respond = (status: number, body: string) =>
  new Response(body, { status });

describe('isCloudApiHost', () => {
  it.each([
    ['https://us.i.posthog.com', true],
    ['https://eu.i.posthog.com', true],
    ['https://app.posthog.com', true],
    ['https://posthog.com', true],
    ['https://posthog.example.com', false],
    ['http://localhost:8010', false],
    ['not a url', false],
  ])('%s -> %s', (host, cloud) => {
    expect(isCloudApiHost(host)).toBe(cloud);
  });
});

describe('probeV1Routes', () => {
  it('posts once to each route without credentials or redirects and accepts only the capture v1 refusal on both', async () => {
    const fetchImpl = fetchFor({
      '/i/v1/analytics/events': respond(401, REFUSAL),
      '/i/v1/ai/events': respond(401, REFUSAL),
    });
    expect(
      await probeV1Routes('https://posthog.example.com/', { fetchImpl }),
    ).toBe(true);
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls as [string, FetchInit][];
    expect(calls.map(([url]) => url).sort()).toEqual([
      'https://posthog.example.com/i/v1/ai/events',
      'https://posthog.example.com/i/v1/analytics/events',
    ]);
    for (const [, init] of calls) {
      expect(init.method).toBe('POST');
      expect(init.redirect).toBe('manual');
      expect(init.headers).toEqual({ 'content-type': 'application/json' });
    }
  });

  it.each([
    ['a 404 from an older build', respond(404, 'not found')],
    ['a proxy page', respond(403, '<html>blocked</html>')],
    [
      'a 401 that is not the capture v1 refusal',
      respond(401, '{"error":"invalid_token"}'),
    ],
    ['a 200', respond(200, '{}')],
    ['a redirect', respond(301, '')],
  ])(
    'is false when the analytics route answers with %s',
    async (_label, answer) => {
      const fetchImpl = fetchFor({
        '/i/v1/analytics/events': answer,
        '/i/v1/ai/events': respond(401, REFUSAL),
      });
      expect(
        await probeV1Routes('https://posthog.example.com', { fetchImpl }),
      ).toBe(false);
    },
  );

  it('is false when only the AI route is missing', async () => {
    const fetchImpl = fetchFor({
      '/i/v1/analytics/events': respond(401, REFUSAL),
      '/i/v1/ai/events': respond(404, ''),
    });
    expect(
      await probeV1Routes('https://posthog.example.com', { fetchImpl }),
    ).toBe(false);
  });

  it('is unreachable when a route gives no answer and none refused', async () => {
    const fetchImpl = fetchFor({
      '/i/v1/analytics/events': new Error('ECONNREFUSED'),
      '/i/v1/ai/events': respond(401, REFUSAL),
    });
    expect(await probeV1Routes('http://localhost:8010', { fetchImpl })).toBe(
      'unreachable',
    );
  });

  it('a definite refusal beats an unreachable route', async () => {
    const fetchImpl = fetchFor({
      '/i/v1/analytics/events': respond(404, ''),
      '/i/v1/ai/events': new Error('timeout'),
    });
    expect(await probeV1Routes('http://localhost:8010', { fetchImpl })).toBe(
      false,
    );
  });

  it('stops waiting when the run aborts', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      (_url: string, init: FetchInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    ) as unknown as typeof fetch;
    const pending = probeV1Routes('http://localhost:8010', {
      fetchImpl,
      signal: controller.signal,
      timeoutMs: 60_000,
    });
    controller.abort();
    expect(await pending).toBe('unreachable');
  });
});

describe('hostServesCaptureV1', () => {
  it('skips the probe for a cloud host and probes anything else', async () => {
    const fetchImpl = fetchFor({
      '/i/v1/analytics/events': respond(404, ''),
      '/i/v1/ai/events': respond(404, ''),
    });
    expect(
      await hostServesCaptureV1('https://us.i.posthog.com', { fetchImpl }),
    ).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      await hostServesCaptureV1('https://posthog.example.com', { fetchImpl }),
    ).toBe(false);
  });
});
