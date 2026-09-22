import { HostResolution } from '@shared/host-resolution';
import type { Credentials } from '@shared/api';
import { gatewayAuth } from '@agent';
import { createPosthogInferenceAuthProvider } from '../credentials';

vi.mock('@agent', () => ({ gatewayAuth: vi.fn() }));

const posthog: Credentials = {
  accessToken: 'pha_fixture',
  projectApiKey: 'phc_fixture',
  projectId: 42,
  host: HostResolution.fromRegion('us'),
};

describe('program inference credentials', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves a scoped bearer on each request so the mint cache can refresh it', async () => {
    const first = {
      gatewayUrl: 'https://ai-gateway.us.posthog.com',
      token: 'phe_first',
      teamId: 42,
      refreshAtMs: 100,
    };
    const renewed = { ...first, token: 'phe_renewed', refreshAtMs: 200 };
    vi.mocked(gatewayAuth)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(renewed);

    const provider = createPosthogInferenceAuthProvider(posthog, 'metrics');
    expect(await provider.resolve()).toEqual(first);
    expect(await provider.resolve()).toEqual(renewed);
    expect(gatewayAuth).toHaveBeenNthCalledWith(
      1,
      posthog.host,
      'pha_fixture',
      'metrics',
    );
    expect(gatewayAuth).toHaveBeenNthCalledWith(
      2,
      posthog.host,
      'pha_fixture',
      'metrics',
    );
  });

  it('does not make an unattributed provider', () => {
    expect(() => createPosthogInferenceAuthProvider(posthog, '')).toThrow(
      'program id',
    );
    expect(gatewayAuth).not.toHaveBeenCalled();
  });
});
