// The proxy-agent packages ship ESM-only builds that jest can't transform, so
// stub them with minimal classes. proxy-from-env resolves to its CJS entry and
// runs for real, exercising the actual env-var / NO_PROXY logic.
jest.mock('http-proxy-agent', () => ({
  HttpProxyAgent: class HttpProxyAgent {
    constructor(public readonly proxy: string) {}
  },
}));
jest.mock('https-proxy-agent', () => ({
  HttpsProxyAgent: class HttpsProxyAgent {
    constructor(public readonly proxy: string) {}
  },
}));

import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getProxyRequestConfig, isProtocolMismatchError } from '@utils/proxy';

describe('getProxyRequestConfig', () => {
  const ENV_KEYS = [
    'HTTP_PROXY',
    'http_proxy',
    'HTTPS_PROXY',
    'https_proxy',
    'NO_PROXY',
    'no_proxy',
  ];
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it('returns an empty config when no proxy env var is set', () => {
    expect(
      getProxyRequestConfig('https://oauth.posthog.com/oauth/token'),
    ).toEqual({});
  });

  it('configures an https proxy agent for an https target', () => {
    process.env.HTTPS_PROXY = 'http://proxy.example.com:8080';

    const config = getProxyRequestConfig(
      'https://oauth.posthog.com/oauth/token',
    );

    expect(config.proxy).toBe(false);
    expect(config.httpsAgent).toBeInstanceOf(HttpsProxyAgent);
    expect(config.httpAgent).toBe(config.httpsAgent);
  });

  it('configures an http proxy agent for an http target', () => {
    process.env.HTTP_PROXY = 'http://proxy.example.com:8080';

    const config = getProxyRequestConfig('http://localhost:8010/oauth/token');

    expect(config.proxy).toBe(false);
    expect(config.httpAgent).toBeInstanceOf(HttpProxyAgent);
  });

  it('respects NO_PROXY and leaves the request unproxied', () => {
    process.env.HTTPS_PROXY = 'http://proxy.example.com:8080';
    process.env.NO_PROXY = '.posthog.com';

    expect(
      getProxyRequestConfig('https://oauth.posthog.com/oauth/token'),
    ).toEqual({});
  });
});

describe('isProtocolMismatchError', () => {
  it('detects the follow-redirects protocol mismatch assertion', () => {
    expect(isProtocolMismatchError(new Error('protocol mismatch'))).toBe(true);
    expect(
      isProtocolMismatchError(new Error('AssertionError: protocol mismatch')),
    ).toBe(true);
  });

  it('ignores unrelated errors and non-errors', () => {
    expect(isProtocolMismatchError(new Error('ECONNREFUSED'))).toBe(false);
    expect(isProtocolMismatchError('protocol mismatch')).toBe(false);
    expect(isProtocolMismatchError(undefined)).toBe(false);
  });
});
