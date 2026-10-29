import type axios from 'axios';
import { analytics } from '@utils/analytics';
import { httpsProxyConfigured, routeAxiosThroughEnvProxy } from '../http-proxy';

vi.mock('@utils/debug', () => ({ logToFile: vi.fn() }));
vi.mock('@utils/analytics', () => ({ analytics: { setTag: vi.fn() } }));

const proxyUrl = 'http://proxy.internal:3128';

function fakeClient(): Pick<typeof axios, 'defaults'> {
  return { defaults: {} } as unknown as Pick<typeof axios, 'defaults'>;
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
