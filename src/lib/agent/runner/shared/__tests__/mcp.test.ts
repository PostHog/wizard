import { extractHttpMcpDescriptors } from '../mcp';
import { WIZARD_USER_AGENT } from '../../../../constants';

describe('extractHttpMcpDescriptors', () => {
  it('returns [] when there are no servers', () => {
    expect(extractHttpMcpDescriptors(undefined)).toEqual([]);
    expect(extractHttpMcpDescriptors({})).toEqual([]);
  });

  it('projects http servers and preserves their headers', () => {
    const descriptors = extractHttpMcpDescriptors({
      'posthog-wizard': {
        type: 'http',
        url: 'https://mcp.posthog.com/mcp',
        headers: { Authorization: 'Bearer phx_x', 'User-Agent': 'custom' },
      },
    });
    expect(descriptors).toEqual([
      {
        name: 'posthog-wizard',
        url: 'https://mcp.posthog.com/mcp',
        headers: { Authorization: 'Bearer phx_x', 'User-Agent': 'custom' },
      },
    ]);
  });

  it('defaults the User-Agent when the server set none', () => {
    const [descriptor] = extractHttpMcpDescriptors({
      extra: { type: 'http', url: 'https://example.com/mcp' },
    });
    expect(descriptor.headers['User-Agent']).toBe(WIZARD_USER_AGENT);
  });

  it('skips the in-process (non-http) wizard-tools server', () => {
    const descriptors = extractHttpMcpDescriptors({
      'posthog-wizard': { type: 'http', url: 'https://mcp.posthog.com/mcp' },
      // The SDK in-process server is a live object with no type/url.
      'wizard-tools': { connect: () => undefined, tools: {} },
    });
    expect(descriptors.map((d) => d.name)).toEqual(['posthog-wizard']);
  });

  it('drops non-string header values', () => {
    const [descriptor] = extractHttpMcpDescriptors({
      s: {
        type: 'http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer x', weird: 42 },
      },
    });
    expect(descriptor.headers).toEqual({
      Authorization: 'Bearer x',
      'User-Agent': WIZARD_USER_AGENT,
    });
  });
});
