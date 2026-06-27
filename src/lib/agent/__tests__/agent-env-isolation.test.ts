import {
  sanitizeAgentSubprocessEnv,
  isBlockedAgentEnvKey,
  BLOCKED_AGENT_ENV_KEYS,
} from '@lib/agent/agent-env-isolation';

describe('isBlockedAgentEnvKey', () => {
  it('blocks the direct API key that outranks the gateway auth token', () => {
    expect(isBlockedAgentEnvKey('ANTHROPIC_API_KEY')).toBe(true);
  });

  it('blocks provider-activation flags (off-gateway routing)', () => {
    expect(isBlockedAgentEnvKey('CLAUDE_CODE_USE_BEDROCK')).toBe(true);
    expect(isBlockedAgentEnvKey('CLAUDE_CODE_USE_VERTEX')).toBe(true);
  });

  it('blocks fd / indirection token sources', () => {
    expect(isBlockedAgentEnvKey('CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR')).toBe(
      true,
    );
    expect(
      isBlockedAgentEnvKey('CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR'),
    ).toBe(true);
    expect(isBlockedAgentEnvKey('CLAUDE_CODE_HOST_AUTH_ENV_VAR')).toBe(true);
  });

  it('blocks alternate base URLs via the pattern, including unseen variants', () => {
    expect(isBlockedAgentEnvKey('ANTHROPIC_BEDROCK_BASE_URL')).toBe(true);
    expect(isBlockedAgentEnvKey('ANTHROPIC_VERTEX_BASE_URL')).toBe(true);
    // A provider variant not in the explicit list is still caught.
    expect(isBlockedAgentEnvKey('ANTHROPIC_SOMETHINGNEW_BASE_URL')).toBe(true);
  });

  it('blocks skip-auth flags via the pattern', () => {
    expect(isBlockedAgentEnvKey('CLAUDE_CODE_SKIP_BEDROCK_AUTH')).toBe(true);
    expect(isBlockedAgentEnvKey('CLAUDE_CODE_SKIP_VERTEX_AUTH')).toBe(true);
    expect(isBlockedAgentEnvKey('CLAUDE_CODE_SKIP_FOUNDRY_AUTH')).toBe(true);
  });

  it('preserves the gateway routing vars the wizard sets', () => {
    expect(isBlockedAgentEnvKey('ANTHROPIC_BASE_URL')).toBe(false);
    expect(isBlockedAgentEnvKey('ANTHROPIC_AUTH_TOKEN')).toBe(false);
    expect(isBlockedAgentEnvKey('CLAUDE_CODE_OAUTH_TOKEN')).toBe(false);
  });

  it('preserves generic system + cloud env (inert without activation flags)', () => {
    for (const key of [
      'PATH',
      'HOME',
      'ANTHROPIC_CUSTOM_HEADERS',
      'AWS_ACCESS_KEY_ID',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'ENABLE_TOOL_SEARCH',
    ]) {
      expect(isBlockedAgentEnvKey(key)).toBe(false);
    }
  });
});

describe('sanitizeAgentSubprocessEnv', () => {
  it('strips every blocked key while keeping the gateway routing', () => {
    const input: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      HOME: '/home/dev',
      // gateway routing the wizard set — must survive
      ANTHROPIC_BASE_URL: 'https://gateway.us.posthog.com/wizard',
      ANTHROPIC_AUTH_TOKEN: 'phx_gateway',
      CLAUDE_CODE_OAUTH_TOKEN: 'phx_gateway',
      ANTHROPIC_CUSTOM_HEADERS: 'x-posthog-...',
      // every avenue — must be gone
      ANTHROPIC_API_KEY: 'sk-ant-user',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_USE_VERTEX: '1',
      ANTHROPIC_BEDROCK_BASE_URL: 'https://bedrock.example',
      ANTHROPIC_VERTEX_PROJECT_ID: 'user-proj',
      AWS_BEARER_TOKEN_BEDROCK: 'aws-bearer',
      CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR: '7',
      CLAUDE_CODE_HOST_AUTH_ENV_VAR: 'MY_SECRET',
      CLAUDE_CODE_SKIP_BEDROCK_AUTH: '1',
    };

    const out = sanitizeAgentSubprocessEnv(input);

    expect(out).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/dev',
      ANTHROPIC_BASE_URL: 'https://gateway.us.posthog.com/wizard',
      ANTHROPIC_AUTH_TOKEN: 'phx_gateway',
      CLAUDE_CODE_OAUTH_TOKEN: 'phx_gateway',
      ANTHROPIC_CUSTOM_HEADERS: 'x-posthog-...',
    });
  });

  it('removes blocked keys entirely (absent, not set to undefined)', () => {
    const out = sanitizeAgentSubprocessEnv({ ANTHROPIC_API_KEY: 'sk' });
    expect('ANTHROPIC_API_KEY' in out).toBe(false);
  });

  it('does not mutate the input env', () => {
    const input: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'sk', PATH: '/bin' };
    sanitizeAgentSubprocessEnv(input);
    expect(input.ANTHROPIC_API_KEY).toBe('sk');
  });

  it('every explicitly-listed key is actually blocked', () => {
    for (const key of BLOCKED_AGENT_ENV_KEYS) {
      expect(isBlockedAgentEnvKey(key)).toBe(true);
    }
  });
});
