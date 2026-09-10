import {
  CiIdentityUnavailable,
  captureCiIdentityRequest,
  ciIdentityMode,
  requestCiIdentityToken,
  resetCiIdentity,
  usesCiIdentity,
} from '@lib/ci-identity';

const REQUEST_URL =
  'https://run-actions-1-azure-eastus.actions.githubusercontent.com/abc/idtoken?api-version=2.0';

describe('CI identity', () => {
  const fetchMock = vi.fn();
  const issued = (value: unknown = 'header.payload.signature') => ({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ value }),
  });

  beforeEach(() => {
    resetCiIdentity();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('WIZARD_CI_IDENTITY', 'github-actions');
    vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_URL', REQUEST_URL);
    vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'runner-request-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('is off unless the run opts in with the exact value', () => {
    vi.stubEnv('WIZARD_CI_IDENTITY', 'true');
    expect(usesCiIdentity()).toBe(false);
  });

  it('reports an unknown opt-in value as unknown, and an empty one as off', () => {
    vi.stubEnv('WIZARD_CI_IDENTITY', 'github');
    expect(ciIdentityMode()).toBe('unknown');
    vi.stubEnv('WIZARD_CI_IDENTITY', '');
    expect(ciIdentityMode()).toBe('off');
  });

  it('takes the request pair out of the environment when the module loads', async () => {
    vi.resetModules();
    await import('@lib/ci-identity');
    expect(process.env.ACTIONS_ID_TOKEN_REQUEST_URL).toBeUndefined();
    expect(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN).toBeUndefined();
  });

  it('takes the request pair out of the environment at capture', () => {
    captureCiIdentityRequest();
    expect(process.env.ACTIONS_ID_TOKEN_REQUEST_URL).toBeUndefined();
    expect(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN).toBeUndefined();
  });

  it('leaves the environment alone when the run does not opt in', () => {
    vi.stubEnv('WIZARD_CI_IDENTITY', '');
    captureCiIdentityRequest();
    expect(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN).toBe(
      'runner-request-token',
    );
  });

  it('asks GitHub for the mint audience with the request token', async () => {
    fetchMock.mockResolvedValue(issued());
    await expect(requestCiIdentityToken()).resolves.toBe(
      'header.payload.signature',
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${REQUEST_URL}&audience=posthog-wizard-ci`);
    expect(init).toMatchObject({
      headers: { Authorization: 'bearer runner-request-token' },
      redirect: 'error',
    });
  });

  it('asks again for every mint, after the pair has left the environment', async () => {
    fetchMock.mockResolvedValue(issued());
    await requestCiIdentityToken();
    await requestCiIdentityToken();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['another host', 'https://evil.example/idtoken?api-version=2.0'],
    [
      'a lookalike host',
      'https://actions.githubusercontent.com.evil.example/idtoken',
    ],
    [
      'a lookalike host with a label before GitHub',
      'https://run.actions.githubusercontent.com.evil.example/idtoken',
    ],
    [
      'plain http',
      'http://run-actions-1-azure-eastus.actions.githubusercontent.com/idtoken',
    ],
    ['something that is not a URL', 'not a url'],
  ])('never sends the request token to %s', async (_, url) => {
    vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_URL', url);
    await expect(requestCiIdentityToken()).rejects.toBeInstanceOf(
      CiIdentityUnavailable,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails when the job was not granted id-token: write', async () => {
    vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_TOKEN', '');
    await expect(requestCiIdentityToken()).rejects.toBeInstanceOf(
      CiIdentityUnavailable,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['a refusal', { ok: false, status: 403, json: () => Promise.resolve({}) }],
    ['a response with no token', issued(null)],
    [
      'a body that is not JSON',
      {
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('bad')),
      },
    ],
  ])('fails on %s', async (_, response) => {
    fetchMock.mockResolvedValue(response);
    await expect(requestCiIdentityToken()).rejects.toBeInstanceOf(
      CiIdentityUnavailable,
    );
  });

  it('bounds the identity request with a ten second timeout', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    try {
      fetchMock.mockResolvedValue(issued());
      await requestCiIdentityToken();
      expect(timeout).toHaveBeenCalledWith(10_000);
      expect(fetchMock.mock.calls[0][1]).toMatchObject({
        signal: timeout.mock.results[0].value,
      });
    } finally {
      timeout.mockRestore();
    }
  });

  it('fails when GitHub does not answer', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(requestCiIdentityToken()).rejects.toBeInstanceOf(
      CiIdentityUnavailable,
    );
  });

  it('never puts the request token in an error', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });
    const error = await requestCiIdentityToken().catch((e: unknown) => e);
    expect((error as Error).message).not.toContain('runner-request-token');
  });
});
