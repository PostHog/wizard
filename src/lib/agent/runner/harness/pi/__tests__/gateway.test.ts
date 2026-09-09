import {
  buildGatewayProvider,
  buildGatewayHeaders,
  isGatewayAuthRejection,
  withGatewayRemint,
  GATEWAY_PROVIDER,
} from '../gateway';
import type { GatewayAuth } from '@lib/gateway-session';

describe('buildGatewayProvider effort', () => {
  const base = {
    gatewayUrl: 'https://ai-gateway.us.posthog.com',
    accessToken: 'phe_x',
    wizardMetadata: {},
    wizardFlags: {},
  };

  it('keeps an explicit off rather than the model table default', () => {
    const { caps } = buildGatewayProvider({
      ...base,
      modelId: 'openai/gpt-5.6-terra',
      effort: 'off',
    });
    // The caps must carry off rather than terra's table medium. On the wire
    // pi omits reasoning_effort for a spec with no thinkingLevelMap, so the
    // provider default applies; this pins the harness's request, not the wire.
    expect(caps.thinkingLevel).toBe('off');
  });

  it('carries a positive override through to the session caps', () => {
    const { caps } = buildGatewayProvider({
      ...base,
      modelId: 'openai/gpt-5.6-terra',
      effort: 'high',
    });
    // pi clamps whatever comes out of here against the levels this model spec
    // declares, so caps is the harness's request, not the final wire value.
    expect(caps.thinkingLevel).toBe('high');
  });
});

describe('buildGatewayProvider transport', () => {
  const base = {
    gatewayUrl: 'https://ai-gateway.us.posthog.com',
    accessToken: 'phe_x',
    wizardMetadata: {},
    wizardFlags: {},
  };

  it('routes openai models over the Responses API', () => {
    // Chat completions rejects function tools combined with reasoning_effort,
    // and every task sends both.
    const { api, baseUrl } = buildGatewayProvider({
      ...base,
      modelId: 'openai/gpt-5.6-terra',
    });
    expect(api).toBe('openai-responses');
    expect(baseUrl).toBe('https://ai-gateway.us.posthog.com/v1');
  });

  it('routes anthropic models over anthropic-messages without /v1', () => {
    const { api, baseUrl } = buildGatewayProvider({
      ...base,
      modelId: 'claude-sonnet-5',
    });
    expect(api).toBe('anthropic-messages');
    expect(baseUrl).toBe('https://ai-gateway.us.posthog.com');
  });
});

describe('buildGatewayHeaders', () => {
  it('carries one properties blob and no per-key or bedrock headers', () => {
    const headers = buildGatewayHeaders(
      { run_id: 'r1' },
      { 'wizard-orchestrator': 'test' },
      42,
    );
    expect(JSON.parse(headers['X-PostHog-Properties'])).toEqual({
      team_id: 42,
      run_id: 'r1',
      'wizard_flag_wizard-orchestrator': 'test',
    });
    expect(headers['x-posthog-use-bedrock-fallback']).toBeUndefined();
    expect(headers['X-POSTHOG-PROPERTY-run_id']).toBeUndefined();
  });
});

describe('isGatewayAuthRejection', () => {
  it.each([
    'OpenAI API error (401): token expired',
    '401 {"type":"error","error":{"type":"authentication_error"}}',
    'Unauthorized',
  ])('recognises %s', (message) => {
    expect(isGatewayAuthRejection(message)).toBe(true);
  });

  it.each([
    'OpenAI API error (429): rate limit',
    'connection reset',
    undefined,
  ])('ignores %s', (message) => {
    expect(isGatewayAuthRejection(message)).toBe(false);
  });

  it("reads pi's diagnostic code rather than the message text", () => {
    expect(
      isGatewayAuthRejection({
        errorMessage: 'the model is unhappy',
        diagnostics: [{ error: { code: 401 } }],
      }),
    ).toBe(true);
    expect(
      isGatewayAuthRejection({
        errorMessage: 'the model is unhappy',
        diagnostics: [{ error: { name: 'AuthenticationError' } }],
      }),
    ).toBe(true);
  });

  it('does not re-mint on a diagnostic that is not an auth rejection', () => {
    expect(
      isGatewayAuthRejection({
        errorMessage: 'rate limited',
        diagnostics: [{ error: { code: 429, name: 'RateLimitError' } }],
      }),
    ).toBe(false);
  });
});

describe('withGatewayRemint', () => {
  const HOUR = 3600_000;
  const rejected = {
    role: 'assistant',
    stopReason: 'error',
    errorMessage: 'OpenAI API error (401): token expired',
  };
  const fine = { role: 'assistant', stopReason: 'stop' };
  const gatewayAuth = (token: string, refreshAtMs: number): GatewayAuth => ({
    gatewayUrl: 'https://ai-gateway.us.posthog.com',
    token,
    teamId: 42,
    refreshAtMs,
  });

  // A fake session: each prompt ends on the next scripted turn. The re-minted
  // bearer is fresh unless a test ages it to pin the once-per-session rule.
  function harness(
    auth: GatewayAuth,
    turns: unknown[],
    remintedAt = Date.now() + HOUR,
  ) {
    const prompts: string[] = [];
    const session = {
      prompt: vi.fn((text: string) => {
        prompts.push(text);
        wrapped.noteAssistantTurn(turns.shift() ?? fine);
        return Promise.resolve();
      }),
    };
    const registry = { registerProvider: vi.fn() };
    const refreshAuth = vi
      .fn()
      .mockResolvedValue(gatewayAuth('phe_new', remintedAt));
    const wrapped = withGatewayRemint({
      session,
      registry,
      auth,
      refreshAuth,
      providerInputs: (a) => ({
        gatewayUrl: a.gatewayUrl,
        accessToken: a.token,
        teamId: a.teamId,
        wizardMetadata: {},
        wizardFlags: {},
        modelId: 'openai/gpt-5.6-terra',
      }),
      continueText: 'continue',
    });
    return { wrapped, registry, refreshAuth, prompts };
  }

  it('re-mints once and continues when a turn ends on a 401 from an aged bearer', async () => {
    const { wrapped, registry, refreshAuth, prompts } = harness(
      gatewayAuth('phe_old', Date.now() - 1),
      [rejected, fine],
    );

    await wrapped.prompt('do it');

    expect(refreshAuth).toHaveBeenCalledTimes(1);
    // pi resolves the apiKey per request, so the re-registered provider is
    // what the continued turn signs with.
    expect(registry.registerProvider).toHaveBeenCalledWith(
      GATEWAY_PROVIDER,
      expect.objectContaining({ apiKey: 'phe_new' }),
    );
    expect(prompts).toEqual(['do it', 'continue']);
  });

  it('leaves a 401 on a fresh bearer to the harness', async () => {
    const { wrapped, refreshAuth, prompts } = harness(
      gatewayAuth('phe_fresh', Date.now() + HOUR),
      [rejected],
    );

    await wrapped.prompt('do it');

    expect(refreshAuth).not.toHaveBeenCalled();
    expect(prompts).toEqual(['do it']);
  });

  it('does not re-mint a second time', async () => {
    // Even with the re-minted bearer already past refresh, one mint per
    // session is the rule.
    const { wrapped, refreshAuth, prompts } = harness(
      gatewayAuth('phe_old', Date.now() - 1),
      [rejected, rejected, rejected],
      Date.now() - 1,
    );

    await wrapped.prompt('do it');
    await wrapped.prompt('again');

    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(prompts).toEqual(['do it', 'continue', 'again']);
  });

  it('ignores a turn that ended without an auth error', async () => {
    const { wrapped, refreshAuth, prompts } = harness(
      gatewayAuth('phe_old', Date.now() - 1),
      [fine],
    );

    await wrapped.prompt('do it');

    expect(refreshAuth).not.toHaveBeenCalled();
    expect(prompts).toEqual(['do it']);
  });
});
