import { PostHogDestination } from '../destinations/posthog';
import { StreamEvent, type TaskStreamUpdate } from '../types';
import { RunPhase, type Credentials } from '../../wizard-session';
import { HostResolution } from '../../host-resolution';

const SAMPLE_CREDS: Credentials = {
  host: HostResolution.fromApiHost('https://us.posthog.com'),
  projectId: 42,
  accessToken: 'pha_abc',
  projectApiKey: 'phc_test',
};

const SAMPLE_PAYLOAD: TaskStreamUpdate = {
  session_id: 'onboarding-posthog_integration-2026-05-20T17:00:00Z',
  workflow_id: 'onboarding',
  skill_id: 'posthog_integration',
  started_at: '2026-05-20T17:00:00Z',
  run_phase: RunPhase.Running,
  tasks: [],
  timestamp: '2026-05-20T17:00:01.000Z',
};

function makeResponse(
  status: number,
  init: { body?: string; headers?: Record<string, string> } = {},
): Response {
  return new Response(init.body ?? '', {
    status,
    headers: init.headers,
  });
}

function makeFetch(responses: Array<Response | Error>): Mock {
  let i = 0;
  return vi.fn(() => {
    const next = responses[i++];
    if (next instanceof Error) return Promise.reject(next);
    if (!next) return Promise.resolve(makeResponse(500));
    return Promise.resolve(next);
  });
}

describe('PostHogDestination', () => {
  it('POSTs to /api/projects/{id}/wizard/sessions/ with Bearer auth', async () => {
    const fetchImpl = makeFetch([makeResponse(201)]);
    const dest = new PostHogDestination({
      getCredentials: () => SAMPLE_CREDS,
      fetchImpl,
    });

    await dest.send(StreamEvent.Update, SAMPLE_PAYLOAD);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://us.posthog.com/api/projects/42/wizard/sessions/');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer pha_abc',
    );
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
    const body = JSON.parse(init.body as string);
    expect(body.session_id).toBe(SAMPLE_PAYLOAD.session_id);
    // timestamp is stripped from the wire body
    expect(body.timestamp).toBeUndefined();
  });

  it('no HTTP call when credentials are not yet set', async () => {
    const fetchImpl = makeFetch([]);
    const dest = new PostHogDestination({
      getCredentials: () => null,
      fetchImpl,
    });

    await dest.send(StreamEvent.Update, SAMPLE_PAYLOAD);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // ── Spec §9 case 9 ───────────────────────────────────────────────

  it('401 disables future pushes for the run', async () => {
    const fetchImpl = makeFetch([
      makeResponse(401),
      makeResponse(201),
      makeResponse(201),
    ]);
    const onError = vi.fn();
    const dest = new PostHogDestination({
      getCredentials: () => SAMPLE_CREDS,
      fetchImpl,
      onError,
      sleep: () => Promise.resolve(),
    });

    await dest.send(StreamEvent.Update, SAMPLE_PAYLOAD);
    await dest.send(StreamEvent.Update, SAMPLE_PAYLOAD);
    await dest.send(StreamEvent.Update, SAMPLE_PAYLOAD);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toContain('401');
  });

  it('403 disables future pushes for the run', async () => {
    const fetchImpl = makeFetch([makeResponse(403), makeResponse(201)]);
    const dest = new PostHogDestination({
      getCredentials: () => SAMPLE_CREDS,
      fetchImpl,
      sleep: () => Promise.resolve(),
    });

    await dest.send(StreamEvent.Update, SAMPLE_PAYLOAD);
    await dest.send(StreamEvent.Update, SAMPLE_PAYLOAD);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // ── Spec §9 case 10 ──────────────────────────────────────────────

  it('5xx retries with backoff, gives up after exactly 3 attempts', async () => {
    const fetchImpl = makeFetch([
      makeResponse(500),
      makeResponse(500),
      makeResponse(500),
    ]);
    const sleep: Mock<(ms: number) => Promise<void>> = vi.fn((_ms: number) =>
      Promise.resolve(),
    );
    const onError = vi.fn();
    const dest = new PostHogDestination({
      getCredentials: () => SAMPLE_CREDS,
      fetchImpl,
      sleep,
      onError,
    });

    await dest.send(StreamEvent.Update, SAMPLE_PAYLOAD);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // Two sleeps between three attempts (500ms, 1000ms).
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0][0]).toBe(500);
    expect(sleep.mock.calls[1][0]).toBe(1000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toContain('500');
  });

  it('network error retries up to 3 attempts', async () => {
    const fetchImpl = makeFetch([
      new Error('ECONNREFUSED'),
      new Error('ECONNREFUSED'),
      new Error('ECONNREFUSED'),
    ]);
    const sleep: Mock<(ms: number) => Promise<void>> = vi.fn((_ms: number) =>
      Promise.resolve(),
    );
    const onError = vi.fn();
    const dest = new PostHogDestination({
      getCredentials: () => SAMPLE_CREDS,
      fetchImpl,
      sleep,
      onError,
    });

    await dest.send(StreamEvent.Update, SAMPLE_PAYLOAD);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('5xx succeeds on retry', async () => {
    const fetchImpl = makeFetch([makeResponse(503), makeResponse(201)]);
    const sleep: Mock<(ms: number) => Promise<void>> = vi.fn((_ms: number) =>
      Promise.resolve(),
    );
    const dest = new PostHogDestination({
      getCredentials: () => SAMPLE_CREDS,
      fetchImpl,
      sleep,
    });

    await dest.send(StreamEvent.Update, SAMPLE_PAYLOAD);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // ── Spec §9 case 11 ──────────────────────────────────────────────

  it('429 respects Retry-After (seconds), single retry, then gives up', async () => {
    const fetchImpl = makeFetch([
      makeResponse(429, { headers: { 'Retry-After': '1' } }),
      makeResponse(429, { headers: { 'Retry-After': '1' } }),
    ]);
    const sleep: Mock<(ms: number) => Promise<void>> = vi.fn((_ms: number) =>
      Promise.resolve(),
    );
    const onError = vi.fn();
    const dest = new PostHogDestination({
      getCredentials: () => SAMPLE_CREDS,
      fetchImpl,
      sleep,
      onError,
    });

    await dest.send(StreamEvent.Update, SAMPLE_PAYLOAD);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(1000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toContain('rate limited');
  });

  it('429 retries successfully on second attempt', async () => {
    const fetchImpl = makeFetch([
      makeResponse(429, { headers: { 'Retry-After': '1' } }),
      makeResponse(201),
    ]);
    const sleep: Mock<(ms: number) => Promise<void>> = vi.fn((_ms: number) =>
      Promise.resolve(),
    );
    const dest = new PostHogDestination({
      getCredentials: () => SAMPLE_CREDS,
      fetchImpl,
      sleep,
    });

    await dest.send(StreamEvent.Update, SAMPLE_PAYLOAD);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // ── Spec §9 case 12 ──────────────────────────────────────────────

  it('400 calls onError, never throws, does not disable', async () => {
    const fetchImpl = makeFetch([
      makeResponse(400, { body: 'invalid run_phase' }),
      makeResponse(201),
    ]);
    const onError = vi.fn();
    const dest = new PostHogDestination({
      getCredentials: () => SAMPLE_CREDS,
      fetchImpl,
      onError,
      sleep: () => Promise.resolve(),
    });

    await dest.send(StreamEvent.Update, SAMPLE_PAYLOAD);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toContain('400');

    // Next send proceeds (not disabled).
    await dest.send(StreamEvent.Update, SAMPLE_PAYLOAD);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('send() never rejects, even when fetch throws repeatedly', async () => {
    const fetchImpl = makeFetch([
      new Error('boom'),
      new Error('boom'),
      new Error('boom'),
    ]);
    const onError = vi.fn();
    const dest = new PostHogDestination({
      getCredentials: () => SAMPLE_CREDS,
      fetchImpl,
      sleep: () => Promise.resolve(),
      onError,
    });

    await expect(
      dest.send(StreamEvent.Update, SAMPLE_PAYLOAD),
    ).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('host with trailing slash is normalized', async () => {
    const fetchImpl = makeFetch([makeResponse(201)]);
    const dest = new PostHogDestination({
      getCredentials: () => ({
        ...SAMPLE_CREDS,
        host: HostResolution.fromApiHost('https://us.posthog.com/'),
      }),
      fetchImpl,
    });

    await dest.send(StreamEvent.Update, SAMPLE_PAYLOAD);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://us.posthog.com/api/projects/42/wizard/sessions/',
    );
  });

  it('caps Retry-After at 60s so an absurd HTTP-date does not exceed setTimeout limits', async () => {
    const fetchImpl = makeFetch([
      makeResponse(429, { headers: { 'Retry-After': '999999' } }),
      makeResponse(201),
    ]);
    const sleep: Mock<(ms: number) => Promise<void>> = vi.fn((_ms: number) =>
      Promise.resolve(),
    );
    const dest = new PostHogDestination({
      getCredentials: () => SAMPLE_CREDS,
      fetchImpl,
      sleep,
    });

    await dest.send(StreamEvent.Update, SAMPLE_PAYLOAD);

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0][0]).toBeLessThanOrEqual(60_000);
    expect(sleep.mock.calls[0][0]).toBeGreaterThan(0);
  });

  it('treats 200 (upsert update) as success, same as 201 (created)', async () => {
    const fetchImpl = makeFetch([makeResponse(200)]);
    const onError = vi.fn();
    const dest = new PostHogDestination({
      getCredentials: () => SAMPLE_CREDS,
      fetchImpl,
      onError,
    });

    await dest.send(StreamEvent.Update, SAMPLE_PAYLOAD);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});
