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

  it('blocks host-only orchestration values the subprocess never reads', () => {
    // POSTHOG_HANDOFF_OUTPUT_PATH names the file the wizard writes the
    // agent's handoff to — leaking it to the subprocess turns the write into
    // a discoverable symlink target. The task ids fingerprint the sandbox run
    // dir where that path typically sits.
    expect(isBlockedAgentEnvKey('POSTHOG_HANDOFF_OUTPUT_PATH')).toBe(true);
    expect(isBlockedAgentEnvKey('POSTHOG_TASK_RUN_ID')).toBe(true);
    expect(isBlockedAgentEnvKey('POSTHOG_TASK_ID')).toBe(true);
  });

  it('still passes through POSTHOG_API_KEY (deliberate, pre-existing disposition)', () => {
    // The agent may rely on it when writing the user's project key into the
    // project's own .env; changing that is a separate decision.
    expect(isBlockedAgentEnvKey('POSTHOG_API_KEY')).toBe(false);
    expect(isBlockedAgentEnvKey('POSTHOG_HOST')).toBe(false);
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
      // — host-only orchestration values (must be STRIPPED: read by the
      //   wizard process only; leaking them fingerprints the run + the
      //   handoff output target) —
      POSTHOG_HANDOFF_OUTPUT_PATH: '/run/task-42/handoff.md',
      POSTHOG_TASK_RUN_ID: 'task-42',
      POSTHOG_TASK_ID: '019abc',
      // — user-facing PostHog config the agent may need for the project .env
      //   (deliberately PRESERVED, pre-existing disposition) —
      POSTHOG_API_KEY: 'phc_project_key',
      POSTHOG_HOST: 'https://us.i.posthog.com',
    };

    const out = sanitizeAgentSubprocessEnv(input);

    expect(out).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/dev',
      AWS_ACCESS_KEY_ID: 'AKIA-for-builds',
      GOOGLE_APPLICATION_CREDENTIALS: '/home/dev/gcp.json',
      POSTHOG_API_KEY: 'phc_project_key',
      POSTHOG_HOST: 'https://us.i.posthog.com',
    });
  });

  it('does not leak the handoff output path to the agent subprocess', () => {
    const out = sanitizeAgentSubprocessEnv({
      POSTHOG_HANDOFF_OUTPUT_PATH: '/run/task-42/handoff.md',
      POSTHOG_TASK_RUN_ID: 'r1',
      POSTHOG_API_KEY: 'phx_secret',
      PATH: '/usr/bin',
    });
    expect('POSTHOG_HANDOFF_OUTPUT_PATH' in out).toBe(false);
    expect('POSTHOG_TASK_RUN_ID' in out).toBe(false);
    expect(out.POSTHOG_API_KEY).toBe('phx_secret');
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
