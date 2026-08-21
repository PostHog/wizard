import {
  buildWizardPropertiesBlob,
  gatewayAuth,
  resetGatewaySession,
} from '@lib/gateway-session';
import type { HostResolution } from '@lib/host-resolution';
import { modelCapabilities } from '@lib/agent/runner/switchboard/models';

const host = {
  apiHost: 'https://us.posthog.com',
  gatewayUrl: 'https://gateway.us.posthog.com/wizard',
} as unknown as HostResolution;

describe('gatewayAuth', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetGatewaySession();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves the v2 posture from a mint response and caches it', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          token: 'phe_minted',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          gateway_url: 'https://gateway.us.posthog.com',
          team_id: 42,
        }),
    });

    const auth = await gatewayAuth(host, 'pha_oauth');
    expect(auth).toEqual({
      gatewayUrl: 'https://gateway.us.posthog.com',
      token: 'phe_minted',
      edition: 'v2',
      teamId: 42,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://us.posthog.com/api/wizard/gateway_token/',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer pha_oauth',
        }),
      }),
    );

    // Second resolve inside the TTL reuses the cache — no second mint.
    await gatewayAuth(host, 'pha_oauth');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the legacy posture when the backend does not mint', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    const auth = await gatewayAuth(host, 'pha_oauth');
    expect(auth).toEqual({
      gatewayUrl: host.gatewayUrl,
      token: 'pha_oauth',
      edition: 'legacy',
    });
  });

  it('falls back to legacy on a transport failure', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    const auth = await gatewayAuth(host, 'pha_oauth');
    expect(auth.edition).toBe('legacy');
    expect(auth.token).toBe('pha_oauth');
  });

  it('falls back to legacy on a malformed mint response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'phe_minted' }), // missing gateway_url/expires_at
    });

    const auth = await gatewayAuth(host, 'pha_oauth');
    expect(auth.edition).toBe('legacy');
  });
});

describe('buildWizardPropertiesBlob', () => {
  it('carries metadata under plain keys, flags as wizard_flag_*, and team_id', () => {
    const blob = JSON.parse(
      buildWizardPropertiesBlob(
        { run_id: 'r1', 'X-POSTHOG-PROPERTY-integration': 'nextjs' },
        { 'wizard-orchestrator': 'test', 'unrelated-flag': 'x' },
        42,
      ),
    );
    expect(blob).toEqual({
      team_id: 42,
      run_id: 'r1',
      integration: 'nextjs',
      'wizard_flag_wizard-orchestrator': 'test',
    });
  });

  it('never emits $-prefixed keys (the gateway strips them as reserved)', () => {
    const blob = JSON.parse(
      buildWizardPropertiesBlob({ run_id: 'r1' }, { 'wizard-x': 'v' }),
    );
    for (const key of Object.keys(blob)) {
      expect(key.startsWith('$')).toBe(false);
    }
  });
});

describe('anthropic effort clamp', () => {
  it('clamps xhigh to high for anthropic-transport models', () => {
    expect(modelCapabilities('claude-sonnet-4-6', 'xhigh').thinkingLevel).toBe(
      'high',
    );
  });

  it('passes xhigh through for openai reasoning models', () => {
    expect(
      modelCapabilities('openai/gpt-5.6-terra', 'xhigh').thinkingLevel,
    ).toBe('xhigh');
  });

  it('leaves sub-xhigh efforts untouched', () => {
    expect(modelCapabilities('claude-sonnet-4-6', 'medium').thinkingLevel).toBe(
      'medium',
    );
  });
});
