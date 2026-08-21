import { buildGatewayProvider, buildGatewayHeaders } from '../gateway';

describe('buildGatewayProvider effort', () => {
  const base = {
    gatewayUrl: 'https://ai-gateway.us.posthog.com',
    accessToken: 'phe_x',
    wizardMetadata: {},
    wizardFlags: {},
  };

  it('clamps an xhigh override on an anthropic model', () => {
    const { caps } = buildGatewayProvider({
      ...base,
      modelId: 'claude-sonnet-4-6',
      effort: 'xhigh',
    });
    // Anthropic rejects xhigh while extended thinking is off, and this is the
    // path the pi session actually builds from.
    expect(caps.thinkingLevel).toBe('high');
  });

  it('passes an xhigh override through on an openai model', () => {
    const { caps } = buildGatewayProvider({
      ...base,
      modelId: 'openai/gpt-5.6-terra',
      effort: 'xhigh',
    });
    expect(caps.thinkingLevel).toBe('xhigh');
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
