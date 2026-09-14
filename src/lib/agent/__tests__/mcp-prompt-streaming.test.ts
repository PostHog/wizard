import { runMcpPromptViaSdk } from '../mcp-prompt-streaming';
import { HostResolution } from '@lib/host-resolution';
import { gatewayAuth } from '@lib/gateway-session';

const mockQuery = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));
vi.mock('@lib/gateway-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lib/gateway-session')>()),
  gatewayAuth: vi.fn(),
}));
vi.mock('@utils/debug', () => ({ logToFile: vi.fn() }));
vi.mock('@utils/analytics', () => ({ analytics: {} }));
vi.mock('../stored-login', () => ({
  createIsolatedAgentConfigDir: () => '/tmp/wizard-test-config',
}));

describe('runMcpPromptViaSdk MCP isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('ANTHROPIC_BASE_URL', '');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '');
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', '');
    vi.stubEnv('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS', '');
    vi.mocked(gatewayAuth).mockResolvedValue({
      gatewayUrl: 'https://gateway.test',
      token: 'fixture-token',
      refreshAtMs: Date.now() + 3600_000,
    });
    mockQuery.mockImplementation(function* () {
      yield { type: 'result', session_id: 'session-1' };
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, 'session-1'])(
    'isolates explicit MCP servers when resuming %s',
    async (resumeSessionId) => {
      const host = HostResolution.fromRegion('us');
      for await (const chunk of runMcpPromptViaSdk({
        prompt: 'Show my events',
        credentials: {
          host,
          accessToken: 'fixture-oauth-token',
          projectApiKey: 'fixture-project-key',
          projectId: 1,
        },
        signal: new AbortController().signal,
        programId: 'mcp',
        resumeSessionId,
      })) {
        expect(chunk).toEqual({ kind: 'done', sessionId: 'session-1' });
      }

      const { options } = mockQuery.mock.calls[0][0];
      expect(options.strictMcpConfig).toBe(true);
      expect(Object.keys(options.mcpServers)).toEqual(['posthog-wizard']);
      expect(options.mcpServers['posthog-wizard']).toMatchObject({
        type: 'http',
        url: host.mcpUrl,
      });
      expect(options.resume).toBe(resumeSessionId);
    },
  );
});
