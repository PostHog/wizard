import {
  sanitizeAgentSubprocessEnv,
  isBlockedAgentEnvKey,
  BLOCKED_AGENT_ENV_KEYS,
} from '@lib/agent/agent-env-isolation';

describe('isBlockedAgentEnvKey', () => {
  it('blocks the direct API key that outranks the gateway auth token', () => {
    expect(isBlockedAgentEnvKey('ANTHROPIC_API_KEY')).toBe(true);
  });

  it('blocks every provider-activation flag the binary OR-s together', () => {
    expect(isBlockedAgentEnvKey('CLAUDE_CODE_USE_BEDROCK')).toBe(true);
    expect(isBlockedAgentEnvKey('CLAUDE_CODE_USE_VERTEX')).toBe(true);
    expect(isBlockedAgentEnvKey('CLAUDE_CODE_USE_FOUNDRY')).toBe(true);
    expect(isBlockedAgentEnvKey('CLAUDE_CODE_USE_MANTLE')).toBe(true);
    expect(isBlockedAgentEnvKey('CLAUDE_CODE_USE_ANTHROPIC_AWS')).toBe(true);
  });

  it('blocks the CLAUDE_CODE_ alt base URL (no *_BASE_URL pattern needed)', () => {
    expect(isBlockedAgentEnvKey('CLAUDE_CODE_API_BASE_URL')).toBe(true);
  });

  it('blocks any future provider-namespace var (no denylist to chase)', () => {
    expect(isBlockedAgentEnvKey('ANTHROPIC_BRAND_NEW_CRED')).toBe(true);
    expect(isBlockedAgentEnvKey('CLAUDE_CODE_SOME_FUTURE_TOKEN')).toBe(true);
  });

  it('blocks inline workload-identity / federation auth', () => {
    expect(isBlockedAgentEnvKey('ANTHROPIC_IDENTITY_TOKEN')).toBe(true);
    expect(isBlockedAgentEnvKey('ANTHROPIC_FEDERATION_RULE_ID')).toBe(true);
    expect(isBlockedAgentEnvKey('ANTHROPIC_SERVICE_ACCOUNT_ID')).toBe(true);
  });

  it('blocks OAuth-refresh / bearer tokens and host-auth-deferral flags', () => {
    expect(isBlockedAgentEnvKey('CLAUDE_CODE_OAUTH_REFRESH_TOKEN')).toBe(true);
    expect(isBlockedAgentEnvKey('CLAUDE_CODE_HFI_BEARER_TOKEN')).toBe(true);
    expect(isBlockedAgentEnvKey('CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST')).toBe(
      true,
    );
    expect(isBlockedAgentEnvKey('CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH')).toBe(
      true,
    );
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

  it('strips even the gateway routing from the INHERITED env (re-injected fresh at spawn)', () => {
    // The whole provider namespace is dropped from what the subprocess inherits;
    // the spawn site re-adds the wizard's own ANTHROPIC_BASE_URL / AUTH_TOKEN /
    // CLAUDE_CODE_OAUTH_TOKEN, so a user shell value can never leak in.
    expect(isBlockedAgentEnvKey('ANTHROPIC_BASE_URL')).toBe(true);
    expect(isBlockedAgentEnvKey('ANTHROPIC_AUTH_TOKEN')).toBe(true);
    expect(isBlockedAgentEnvKey('CLAUDE_CODE_OAUTH_TOKEN')).toBe(true);
    // ANTHROPIC_CUSTOM_HEADERS is likewise re-injected at the spawn site.
    expect(isBlockedAgentEnvKey('ANTHROPIC_CUSTOM_HEADERS')).toBe(true);
  });

  it('preserves generic system + cloud build env', () => {
    for (const key of [
      'PATH',
      'HOME',
      'AWS_ACCESS_KEY_ID',
      'AWS_PROFILE',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'HTTPS_PROXY',
      'NODE_EXTRA_CA_CERTS',
      'ENABLE_TOOL_SEARCH',
    ]) {
      expect(isBlockedAgentEnvKey(key)).toBe(false);
    }
  });
});

describe('sanitizeAgentSubprocessEnv', () => {
  it('drops the whole provider namespace, keeping only generic env', () => {
    const input: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      HOME: '/home/dev',
      AWS_ACCESS_KEY_ID: 'AKIA-for-builds',
      GOOGLE_APPLICATION_CREDENTIALS: '/home/dev/gcp.json',
      // every provider-namespace var — must be gone (incl. gateway routing,
      // which the spawn site re-injects with the wizard's own values)
      ANTHROPIC_BASE_URL: 'https://user-shell.example',
      ANTHROPIC_AUTH_TOKEN: 'leaked',
      CLAUDE_CODE_OAUTH_TOKEN: 'leaked',
      ANTHROPIC_CUSTOM_HEADERS: 'x-posthog-...',
      ANTHROPIC_API_KEY: 'sk-ant-user',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_USE_FOUNDRY: '1',
      ANTHROPIC_VERTEX_PROJECT_ID: 'user-proj',
      AWS_BEARER_TOKEN_BEDROCK: 'aws-bearer',
      CLAUDE_CODE_SOME_FUTURE_KNOB: '1',
    };

    const out = sanitizeAgentSubprocessEnv(input);

    expect(out).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/dev',
      AWS_ACCESS_KEY_ID: 'AKIA-for-builds',
      GOOGLE_APPLICATION_CREDENTIALS: '/home/dev/gcp.json',
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
