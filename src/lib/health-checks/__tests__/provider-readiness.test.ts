import {
  evaluateModelProviderReadiness,
  ServiceHealthStatus,
} from '@lib/health-checks';

const ANTHROPIC_SUMMARY_URL = 'https://status.claude.com/api/v2/summary.json';
const OPENAI_SUMMARY_URL = 'https://status.openai.com/api/v2/summary.json';

function summary(name: string, status: string): Response {
  return new Response(
    JSON.stringify({
      status: { indicator: status === 'operational' ? 'none' : 'minor' },
      components: [{ id: 'component', name, status }],
    }),
    { status: 200 },
  );
}

describe('model provider readiness', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('checks OpenAI Responses for an OpenAI model', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(summary('Responses', 'operational')),
    );

    const result = await evaluateModelProviderReadiness('openai/gpt-5.6-terra');

    expect(global.fetch).toHaveBeenCalledWith(
      OPENAI_SUMMARY_URL,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result).toMatchObject({
      provider: 'openai',
      service: 'OpenAI Responses API',
      health: { status: ServiceHealthStatus.Healthy },
      blocksRun: false,
    });
  });

  it('checks the Claude API component for an Anthropic model', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(summary('Claude API (api.anthropic.com)', 'operational')),
    );

    const result = await evaluateModelProviderReadiness('claude-sonnet-4-6');

    expect(global.fetch).toHaveBeenCalledWith(
      ANTHROPIC_SUMMARY_URL,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result).toMatchObject({
      provider: 'anthropic',
      service: 'Anthropic API',
      health: { status: ServiceHealthStatus.Healthy },
      blocksRun: false,
    });
  });

  it('blocks only a confirmed outage on the selected component', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(summary('Responses', 'partial_outage')),
    );

    const result = await evaluateModelProviderReadiness('openai/gpt-5.6-terra');

    expect(result.health.status).toBe(ServiceHealthStatus.Down);
    expect(result.blocksRun).toBe(true);
  });

  it('keeps degraded provider status advisory', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(summary('Responses', 'degraded_performance')),
    );

    const result = await evaluateModelProviderReadiness('openai/gpt-5.6-terra');

    expect(result.health.status).toBe(ServiceHealthStatus.Degraded);
    expect(result.blocksRun).toBe(false);
  });

  it('keeps status lookup failures advisory', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('ECONNRESET')));

    const result = await evaluateModelProviderReadiness('openai/gpt-5.6-terra');

    expect(result.health).toMatchObject({
      status: ServiceHealthStatus.Degraded,
      error: 'ECONNRESET',
    });
    expect(result.blocksRun).toBe(false);
  });
});
