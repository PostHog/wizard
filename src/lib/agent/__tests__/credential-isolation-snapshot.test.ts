/**
 * Credential-isolation path snapshot.
 *
 * One deterministic, offline golden for *every* avenue by which the agent SDK's
 * native binary could authenticate off the PostHog gateway, and the wizard's
 * disposition of each. The expected dispositions are grounded in a live probe
 * matrix against `@anthropic-ai/claude-agent-sdk@0.3.169` + its binary (a shell
 * `ANTHROPIC_API_KEY` outranks the gateway token; `CLAUDE_CODE_USE_BEDROCK`
 * routes to Bedrock; `settingSources:['project']` ignores user/project-local
 * but not the project file or managed settings).
 *
 * Update the golden with `vitest -u` only after an intentional change to the
 * isolation surface — a diff here means a credential path changed disposition.
 */

import { sanitizeAgentSubprocessEnv } from '@lib/agent/agent-env-isolation';
import { classifySettingsConflicts } from '@lib/agent/claude-settings';
import type { SettingsConflict } from '@lib/agent/claude-settings';

// Every env-based avenue (one key each), plus the gateway routing and benign
// env that must survive. Grouped by avenue for readability; the snapshot sorts.
const ALL_PATHS_ENV: NodeJS.ProcessEnv = {
  // — gateway routing the wizard pins (must be PRESERVED) —
  ANTHROPIC_BASE_URL: 'https://gateway.us.posthog.com/wizard',
  ANTHROPIC_AUTH_TOKEN: 'phx_gateway',
  CLAUDE_CODE_OAUTH_TOKEN: 'phx_gateway',
  ANTHROPIC_CUSTOM_HEADERS: 'x-posthog-use-bedrock-fallback=true',
  // — benign system / build env (must be PRESERVED) —
  PATH: '/usr/bin',
  HOME: '/home/dev',
  AWS_ACCESS_KEY_ID: 'AKIA_for_user_build_commands',
  GOOGLE_APPLICATION_CREDENTIALS: '/home/dev/gcp.json',
  // — direct API key (outranks the gateway token) —
  ANTHROPIC_API_KEY: 'sk-ant-api03-FAKE',
  // — provider activation (off-gateway routing) —
  CLAUDE_CODE_USE_BEDROCK: '1',
  CLAUDE_CODE_USE_VERTEX: '1',
  // — alternate base URLs (explicit + an unseen variant via pattern) —
  ANTHROPIC_BEDROCK_BASE_URL: 'https://x',
  ANTHROPIC_AWS_BASE_URL: 'https://x',
  ANTHROPIC_VERTEX_BASE_URL: 'https://x',
  ANTHROPIC_FOUNDRY_BASE_URL: 'https://x',
  ANTHROPIC_BEDROCK_MANTLE_BASE_URL: 'https://x',
  ANTHROPIC_NEWPROVIDER_BASE_URL: 'https://x',
  // — third-party / alternate provider keys —
  ANTHROPIC_AWS_API_KEY: 'x',
  ANTHROPIC_FOUNDRY_API_KEY: 'x',
  AWS_BEARER_TOKEN_BEDROCK: 'x',
  // — file-descriptor / file / indirection token sources —
  CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR: '7',
  CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: '8',
  ANTHROPIC_IDENTITY_TOKEN_FILE: '/tmp/id',
  CLAUDE_CODE_HOST_AUTH_ENV_VAR: 'SOME_OTHER_VAR',
  CLAUDE_CODE_SESSION_ACCESS_TOKEN: 'x',
  CLAUDE_CODE_CLIENT_KEY: 'x',
  // — skip-auth flags (explicit + pattern) —
  CLAUDE_CODE_SKIP_BEDROCK_AUTH: '1',
  CLAUDE_CODE_SKIP_VERTEX_AUTH: '1',
  CLAUDE_CODE_SKIP_FOUNDRY_AUTH: '1',
  // — profile / environment / vertex / helper-ttl selectors —
  ANTHROPIC_PROFILE: 'x',
  ANTHROPIC_ENVIRONMENT_KEY: 'x',
  ANTHROPIC_VERTEX_PROJECT_ID: 'x',
  CLAUDE_CODE_API_KEY_HELPER_TTL_MS: '1000',
};

describe('credential-isolation paths (snapshot)', () => {
  it('subprocess env: disposition of every credential path', () => {
    const out = sanitizeAgentSubprocessEnv(ALL_PATHS_ENV);
    const disposition = Object.fromEntries(
      Object.keys(ALL_PATHS_ENV)
        .sort()
        .map((key) => [key, key in out ? 'preserved' : 'stripped']),
    );
    expect(disposition).toMatchSnapshot();
  });

  it('settings-file conflicts: neutralize / warn / fail-closed disposition', () => {
    const conflicts: SettingsConflict[] = [
      // writable project file — SDK reads it; wizard can remove it
      {
        source: 'project',
        path: '/proj/.claude/settings.json',
        keys: ['ANTHROPIC_BASE_URL'],
        writable: true,
      },
      // org-managed — always read, unremovable
      {
        source: 'managed',
        path: '/managed/managed-settings.json',
        keys: ['apiKeyHelper'],
        writable: false,
      },
      // user global — ignored under settingSources:['project']
      {
        source: 'user',
        path: '/home/.claude/settings.json',
        keys: ['ANTHROPIC_API_KEY'],
        writable: false,
      },
      // project-local — ignored under settingSources:['project']
      {
        source: 'project-local',
        path: '/proj/.claude/settings.local.json',
        keys: ['CLAUDE_CODE_USE_BEDROCK'],
        writable: false,
      },
    ];

    const { autoFix, failClosed, warnOnly } =
      classifySettingsConflicts(conflicts);

    expect({
      autoFix_neutralize: autoFix.map((c) => c.source),
      failClosed_userFixes: failClosed.map((c) => c.source),
      warnOnly_alreadyIgnored: warnOnly.map((c) => c.source),
    }).toMatchSnapshot();
  });
});
