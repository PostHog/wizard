import { gatewayAuth } from '@agent/gateway-session';
import { createTriageLLMProvider } from '@agent/triage-provider';
import { prepareRun } from '../shared/bootstrap';
import type { RunConfig, RunInput } from '../shared/types';

vi.mock('@agent/gateway-session', () => ({ gatewayAuth: vi.fn() }));
vi.mock('@agent/triage-provider', () => ({ createTriageLLMProvider: vi.fn() }));
vi.mock('@utils/debug', () => ({ logToFile: vi.fn() }));

const auth = {
  gatewayUrl: 'https://ai-gateway.us.posthog.com',
  token: 'phe_fixture',
  teamId: 42,
  refreshAtMs: Infinity,
};

const config = {
  programId: 'metrics',
  skillsBaseUrl: 'https://example.test/skills',
  wizardFlags: {},
  wizardFlagPayloads: {},
  wizardMetadata: {},
  binding: { harness: 'pi' },
} as unknown as RunConfig;

const input = {
  installDir: '/tmp/project',
  credentials: {
    accessToken: 'pha_fixture',
    host: { apiHost: 'https://us.posthog.com' },
  },
  flags: { localMcp: false },
  host: {},
} as unknown as RunInput;

describe('agent inference auth input', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gatewayAuth).mockResolvedValue(auth);
  });

  it('uses the provided resolver for boot and triage without touching the PostHog access token', async () => {
    const resolve = vi.fn().mockResolvedValue(auth);
    const boot = await prepareRun(config, {
      ...input,
      inferenceAuth: { resolve },
    });

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(gatewayAuth).not.toHaveBeenCalled();
    expect(boot.inferenceAuth).toEqual({ resolve });
    expect(createTriageLLMProvider).toHaveBeenCalledWith(
      expect.any(Function),
      config.binding.harness,
    );
    const currentAuth = vi.mocked(createTriageLLMProvider).mock.calls[0][0];
    if (typeof currentAuth !== 'function')
      throw new Error('triage did not receive a credential resolver');
    expect(await currentAuth()).toEqual(
      expect.objectContaining({
        baseURL: auth.gatewayUrl,
        authToken: auth.token,
        teamId: auth.teamId,
      }),
    );
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(gatewayAuth).not.toHaveBeenCalled();
  });

  it('retains the legacy mint when no provider was supplied', async () => {
    const boot = await prepareRun(config, input);

    expect(gatewayAuth).toHaveBeenCalledWith(
      input.credentials.host,
      input.credentials.accessToken,
      config.programId,
    );
    expect(await boot.inferenceAuth.resolve()).toEqual(auth);
  });
});
