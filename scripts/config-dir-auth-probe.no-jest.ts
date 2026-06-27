/**
 * Does CLAUDE_CONFIG_DIR actually govern the Agent SDK's credential resolution?
 *
 * Repeatable, offline experiment — no gateway and no valid token needed: the
 * SDK reports `apiKeySource` in its `init` system message, which fires from
 * local credential resolution BEFORE any API call. We plant a bogus stored
 * login and read `apiKeySource` under each CLAUDE_CONFIG_DIR / token setting,
 * then abort.
 *
 * Reads:
 *   - apiKeySource "/login managed key"  → the SDK used the stored credentials
 *     file under CLAUDE_CONFIG_DIR.
 *   - apiKeySource "none"                → it did not (isolated / not found).
 *
 * Run: node_modules/.bin/tsx scripts/config-dir-auth-probe.no-jest.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import path from 'path';
import { query } from '@anthropic-ai/claude-agent-sdk';

// A plausible Claude `/login` credentials file (bogus token — never used for a
// real call; we abort after reading apiKeySource).
const BOGUS_CREDENTIALS = JSON.stringify({
  claudeAiOauth: {
    accessToken: 'sk-ant-oat01-BOGUS-not-a-real-token',
    refreshToken: 'bogus-refresh',
    expiresAt: 9999999999999,
    scopes: ['user:inference'],
  },
});

function mkConfigDir(withCredentials: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgprobe-'));
  if (withCredentials) {
    fs.writeFileSync(path.join(dir, '.credentials.json'), BOGUS_CREDENTIALS);
  }
  return dir;
}

async function apiKeySourceFor(opts: {
  configDir?: string;
  oauthToken?: string;
}): Promise<string> {
  if (opts.configDir) process.env.CLAUDE_CONFIG_DIR = opts.configDir;
  else delete process.env.CLAUDE_CONFIG_DIR;
  if (opts.oauthToken) process.env.CLAUDE_CODE_OAUTH_TOKEN = opts.oauthToken;
  else delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  // Point at a dead URL so nothing leaks if a call were attempted; we abort at init.
  process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:9';
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;

  const abortController = new AbortController();
  const res = query({
    prompt: 'noop',
    options: { abortController, maxTurns: 1, model: 'claude-sonnet-4-6' },
  });
  try {
    for await (const m of res as AsyncIterable<any>) {
      if (m.type === 'system' && m.subtype === 'init') {
        abortController.abort();
        return m.apiKeySource ?? '(unset)';
      }
    }
  } catch (e) {
    return `(error: ${(e as Error).message})`;
  }
  return '(no init message)';
}

async function main() {
  const credDir = mkConfigDir(true);
  const emptyDir = mkConfigDir(false);
  const TOKEN = 'sk-ant-oat01-WIZARD-FAKE-gateway-token';

  const scenarios: Array<
    [string, { configDir?: string; oauthToken?: string }]
  > = [
    // Keychain path (this machine has a real "Claude Code-credentials" login):
    // it is only read when CLAUDE_CONFIG_DIR is UNSET and no token is set.
    ['UNSET config, NO token (real keychain)', {}],
    ['SET empty config, NO token (keychain skipped)', { configDir: emptyDir }],
    // File path with a planted credentials.json:
    ['cred file, NO token', { configDir: credDir }],
    [
      'cred file + token (wizard, pre-fix)',
      { configDir: credDir, oauthToken: TOKEN },
    ],
    [
      'empty dir + token  (wizard, post-fix)',
      { configDir: emptyDir, oauthToken: TOKEN },
    ],
  ];

  console.log('CLAUDE_CONFIG_DIR credential-resolution probe\n');
  for (const [label, opts] of scenarios) {
    const src = await apiKeySourceFor(opts);
    console.log(`  ${label.padEnd(38)} -> apiKeySource: ${src}`);
  }

  console.log(
    '\nIf row 2 (cred file + token) shows "/login managed key", the SDK reads\n' +
      'the credentials file from CLAUDE_CONFIG_DIR even with our token set — the\n' +
      'real bug — and row 3 (empty dir) flipping to "none"/token proves isolation fixes it.',
  );

  fs.rmSync(credDir, { recursive: true, force: true });
  fs.rmSync(emptyDir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error('probe failed:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
