import type axios from 'axios';
import { analytics } from '@utils/analytics';
import {
  httpsProxyConfigured,
  redactErrorCredentials,
  redactUrlCredentials,
  routeAxiosThroughEnvProxy,
} from '../http-proxy';

vi.mock('@utils/debug', () => ({ logToFile: vi.fn() }));
vi.mock('@utils/analytics', () => ({ analytics: { setTag: vi.fn() } }));

const proxyUrl = 'http://proxy.internal:3128';

type Client = Pick<typeof axios, 'defaults' | 'interceptors'>;

function fakeClient(): Client {
  return {
    defaults: {},
    interceptors: { response: { use: vi.fn() } },
  } as unknown as Client;
}

describe('routeAxiosThroughEnvProxy', () => {
  beforeEach(() => vi.mocked(analytics.setTag).mockClear());

  it('never tags the proxy URL', () => {
    routeAxiosThroughEnvProxy(
      { HTTPS_PROXY: proxyUrl },
      'v22.22.0',
      fakeClient(),
    );

    expect(
      JSON.stringify(vi.mocked(analytics.setTag).mock.calls),
    ).not.toContain('proxy.internal');
  });

  it('leaves axios alone with no proxy in the environment', () => {
    const client = fakeClient();

    expect(routeAxiosThroughEnvProxy({}, 'v22.22.0', client)).toBe('none');
    expect(client.defaults).toEqual({});
    expect(analytics.setTag).toHaveBeenCalledWith('env_proxy', 'none');
  });

  it.each(['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'npm_config_proxy'])(
    'routes axios through Node agents for %s',
    (name) => {
      const client = fakeClient();

      expect(
        routeAxiosThroughEnvProxy({ [name]: proxyUrl }, 'v22.22.0', client),
      ).toBe('tunnel');
      expect(analytics.setTag).toHaveBeenCalledWith('env_proxy', 'tunnel');
      expect(client.defaults.proxy).toBe(false);
      expect(client.defaults.httpsAgent).toBeDefined();
      expect(client.defaults.httpAgent).toBeDefined();
    },
  );

  it.each(['v22.22.0', 'v24.5.0', 'v25.0.0', 'v26.1.0'])(
    'applies on Node %s',
    (version) => {
      expect(
        routeAxiosThroughEnvProxy(
          { HTTPS_PROXY: proxyUrl },
          version,
          fakeClient(),
        ),
      ).toBe('tunnel');
    },
  );

  it.each(['v23.11.0', 'v24.4.0'])(
    'keeps axios handling on Node %s, which lacks proxyEnv',
    (version) => {
      const client = fakeClient();

      expect(
        routeAxiosThroughEnvProxy({ HTTPS_PROXY: proxyUrl }, version, client),
      ).toBe('unsupported_node');
      expect(client.defaults).toEqual({});
      expect(analytics.setTag).toHaveBeenCalledWith(
        'env_proxy',
        'unsupported_node',
      );
    },
  );
});

describe('httpsProxyConfigured', () => {
  it.each(['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'npm_config_proxy'])(
    'sees %s',
    (name) => {
      expect(
        httpsProxyConfigured({ [name]: 'http://proxy.internal:3128' }),
      ).toBe(true);
    },
  );

  it('ignores an http-only or empty proxy', () => {
    expect(
      httpsProxyConfigured({
        HTTP_PROXY: 'http://proxy:3128',
        HTTPS_PROXY: '',
      }),
    ).toBe(false);
  });
});

describe('proxy credential redaction', () => {
  const tunnelMessage =
    'Failed to establish tunnel to us.posthog.com:443 via http://alice:s3cret@proxy.internal:3128: HTTP/1.1 407 Proxy Authentication Required';

  it('removes userinfo from a URL in text', () => {
    expect(redactUrlCredentials(tunnelMessage)).toBe(
      'Failed to establish tunnel to us.posthog.com:443 via http://***@proxy.internal:3128: HTTP/1.1 407 Proxy Authentication Required',
    );
  });

  it('leaves text without credentials alone', () => {
    const text = 'GET https://us.posthog.com/api/projects/1/ failed';
    expect(redactUrlCredentials(text)).toBe(text);
  });

  it('scrubs the message, stack and cause chain', () => {
    const cause = new Error(tunnelMessage);
    const error = new Error(`request failed: ${tunnelMessage}`, { cause });

    redactErrorCredentials(error);

    for (const e of [error, cause]) {
      expect(e.message).not.toContain('s3cret');
      expect(e.stack).not.toContain('s3cret');
    }
  });

  it('installs the scrubber only when tunnelling', () => {
    const tunnelled = fakeClient();
    routeAxiosThroughEnvProxy({ HTTPS_PROXY: proxyUrl }, 'v22.22.0', tunnelled);
    expect(tunnelled.interceptors.response.use).toHaveBeenCalledTimes(1);

    const direct = fakeClient();
    routeAxiosThroughEnvProxy({}, 'v22.22.0', direct);
    expect(direct.interceptors.response.use).not.toHaveBeenCalled();
  });
});
