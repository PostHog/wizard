import { buildGatewayProvider, buildGatewayHeaders } from '../gateway';

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
      modelId: 'claude-sonnet-4-6',
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
      ai_product: 'wizard',
      team_id: 42,
      run_id: 'r1',
      'wizard_flag_wizard-orchestrator': 'test',
    });
    expect(headers['x-posthog-use-bedrock-fallback']).toBeUndefined();
    expect(headers['X-POSTHOG-PROPERTY-run_id']).toBeUndefined();
  });
});
