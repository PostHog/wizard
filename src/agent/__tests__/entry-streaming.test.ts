import { rmSync } from 'node:fs';
import { runMcpPromptViaSdk } from '@agent';
import type { AgentChunk } from '@agent/types';
import {
  configureGatewayCredentialsForCI,
  resetGatewaySession,
} from '@agent/gateway-session';
import { HostResolution } from '@shared/host-resolution';

const { query } = vi.hoisted(() => ({
  query:
    vi.fn<
      (args: {
        options: { env: { CLAUDE_CONFIG_DIR: string } };
      }) => Generator<unknown>
    >(),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query }));

async function consume(
  overrides: Partial<Parameters<typeof runMcpPromptViaSdk>[0]> = {},
): Promise<AgentChunk[]> {
  const chunks: AgentChunk[] = [];
  for await (const chunk of runMcpPromptViaSdk({
    prompt: 'List events',
    credentials: {
      accessToken: 'test-access-token',
      projectApiKey: 'test-project-key',
      projectId: 1,
      host: HostResolution.fromRegion('us'),
    },
    signal: new AbortController().signal,
    programId: 'mcp-tutorial',
    ...overrides,
  })) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('public agent prompt stream', () => {
  beforeEach(() => {
    for (const name of [
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_AUTH_TOKEN',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
    ]) {
      vi.stubEnv(name, process.env[name]);
    }
    configureGatewayCredentialsForCI(
      'test-gateway-token',
      1,
      'https://ai-gateway.us.posthog.com',
    );
  });

  afterEach(() => {
    for (const [args] of query.mock.calls) {
      rmSync(args.options.env.CLAUDE_CONFIG_DIR, {
        recursive: true,
        force: true,
      });
    }
    query.mockReset();
    resetGatewaySession();
    vi.unstubAllEnvs();
  });

  it('forwards text and completion with the resumable session ID', async () => {
    query.mockImplementation(function* () {
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Found three events.' }] },
      };
      yield { type: 'result', subtype: 'success', session_id: 'session-123' };
    });

    await expect(consume()).resolves.toEqual([
      { kind: 'text', text: 'Found three events.' },
      { kind: 'done', sessionId: 'session-123' },
    ]);
  });

  it('forwards an SDK stream failure after partial output', async () => {
    query.mockImplementation(function* () {
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Checking events...' }] },
      };
      throw new Error('SDK connection lost');
    });

    await expect(consume()).resolves.toEqual([
      { kind: 'text', text: 'Checking events...' },
      { kind: 'error', text: 'SDK connection lost' },
    ]);
  });

  it('propagates setup failures instead of silently ending the stream', async () => {
    resetGatewaySession();

    await expect(consume({ programId: undefined })).rejects.toThrow(
      'this run has no program to attribute its spend to',
    );
  });
});
