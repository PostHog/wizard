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

describe('buildGatewayHeaders', () => {
  it('carries one blob and no bedrock opt-in for v2', () => {
    const headers = buildGatewayHeaders({ run_id: 'r1' }, {}, 'v2', 42);
    expect(headers['X-PostHog-Properties']).toContain('run_id');
    expect(headers['x-posthog-use-bedrock-fallback']).toBeUndefined();
  });

  it('carries per-key headers for legacy', () => {
    const headers = buildGatewayHeaders({ run_id: 'r1' }, {}, 'legacy');
    expect(headers['X-POSTHOG-PROPERTY-run_id']).toBe('r1');
    expect(headers['x-posthog-use-bedrock-fallback']).toBe('true');
  });
});
