import { HostResolution } from '@shared/host-resolution';
import type { Credentials } from '@shared/api';
import { gatewayAuth } from '../gateway-session';
import { createPosthogInferenceAuthProvider } from '../credentials';

vi.mock('../gateway-session', () => ({ gatewayAuth: vi.fn() }));

const posthog: Credentials = {
  accessToken: 'pha_fixture',
  projectApiKey: 'phc_fixture',
  projectId: 42,
  host: HostResolution.fromRegion('us'),
};

it('resolves a scoped bearer on each request so the mint cache can refresh it', async () => {
  const auth = {
    gatewayUrl: 'https://ai-gateway.us.posthog.com',
    token: 'phe_fixture',
    teamId: 42,
    refreshAtMs: 100,
  };
  vi.mocked(gatewayAuth).mockResolvedValue(auth);

  const provider = createPosthogInferenceAuthProvider(posthog, 'metrics');
  await provider.resolve();
  expect(await provider.resolve()).toBe(auth);
  expect(gatewayAuth).toHaveBeenCalledTimes(2);
  expect(gatewayAuth).toHaveBeenLastCalledWith(
    posthog.host,
    'pha_fixture',
    'metrics',
  );
});
