/**
 * Detect a pre-existing Claude Code login on the machine.
 *
 * The wizard authenticates the agent's LLM calls by injecting its PostHog OAuth
 * token via `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_AUTH_TOKEN`. If the user is
 * already logged into Claude Code/Desktop, the Agent SDK can instead use that
 * stored `/login` credential (reported as `apiKeySource: "/login managed key"`)
 * and send it to the PostHog gateway, which rejects it with a 401.
 *
 * The settings-conflict scan ({@link checkAllSettingsConflicts}) only inspects
 * `settings.json` for `ANTHROPIC_*` overrides / `apiKeyHelper`; it has no
 * awareness of an actual logged-in session. This fills that gap so a run can
 * log and report the potential conflict behind a gateway 401.
 *
 * Existence-only: it never reads the credential value (no `-w`), so no secret
 * is ever exposed. The locations checked mirror the SDK's own resolution
 * (npmjs.com/package/@anthropic-ai/claude-agent-sdk → sdk.mjs): a
 * `.credentials.json` under `CLAUDE_CONFIG_DIR` / `~/.claude`, and the macOS
 * keychain item below. {@link isolatedAgentCredentialEnv} closes both.
 */
import * as fs from 'fs';
import * as os from 'os';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { logToFile } from '@utils/debug';
import { analytics } from '@utils/analytics';

/** macOS keychain service name Claude Code stores its login under. */
const KEYCHAIN_SERVICE = 'Claude Code-credentials';

export interface StoredClaudeLogin {
  /** `$CLAUDE_CONFIG_DIR/.credentials.json` (or `~/.claude/.credentials.json`) exists. */
  credentialsFile: boolean;
  /** macOS keychain holds a `Claude Code-credentials` item. */
  keychain: boolean;
}

/** True when any stored login was found. */
export const hasStoredClaudeLogin = (login: StoredClaudeLogin): boolean =>
  login.credentialsFile || login.keychain;

/**
 * The directory Claude Code resolves credentials/config from — `CLAUDE_CONFIG_DIR`
 * if set, else `~/.claude`. Mirrors the SDK's own resolution; single source of
 * truth so callers can't drift from it.
 */
export const claudeConfigDir = (homeDir: string = os.homedir()): string =>
  process.env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude');

/**
 * Create a fresh, empty config dir for the agent subprocess and return its path.
 *
 * `mkdtempSync` gives each run its own dir, so concurrent runs never share one.
 * `/tmp` on macOS/Linux matches the agent sandbox's writable roots; Windows has
 * no `/tmp`, so fall back to the OS temp dir there.
 */
function createIsolatedAgentConfigDir(): string {
  const base = process.platform === 'win32' ? os.tmpdir() : '/tmp';
  return fs.mkdtempSync(path.join(base, 'posthog-wizard-claude-'));
}

/**
 * The credential-isolation env the spawn sites hand the `claude` binary. Both
 * vars point at one fresh, empty dir, which cuts the binary off from BOTH halves
 * of a stored login:
 *
 * - `CLAUDE_CONFIG_DIR` is where the binary reads `.credentials.json` and
 *   `.claude.json` from. An empty dir has neither.
 * - `CLAUDE_SECURESTORAGE_CONFIG_DIR` is where it reads the *secure* store from.
 *   On macOS that store is the keychain, and the binary derives the keychain
 *   service name from this dir — `Claude Code-credentials` for the default dir,
 *   `Claude Code-credentials-<hash of the dir>` otherwise. A per-run temp dir
 *   therefore names an item that does not exist, so the lookup finds nothing.
 *
 * Setting the second var explicitly matters twice over. It is outside the
 * `ANTHROPIC_*` / `CLAUDE_CODE_*` namespace that `sanitizeAgentSubprocessEnv`
 * strips, so a value in the user's shell would otherwise survive and point the
 * keychain lookup back at the real `Claude Code-credentials` item. And it pins
 * the keychain namespace directly instead of leaving it to the binary's
 * undocumented fallback to `CLAUDE_CONFIG_DIR`.
 *
 * The gateway token alone is not enough: a stored login travels as an
 * `x-api-key` header, which the binary resolves separately from — and does not
 * suppress with — the `ANTHROPIC_AUTH_TOKEN` the wizard injects.
 */
export function isolatedAgentCredentialEnv(): {
  CLAUDE_CONFIG_DIR: string;
  CLAUDE_SECURESTORAGE_CONFIG_DIR: string;
} {
  const dir = createIsolatedAgentConfigDir();
  return { CLAUDE_CONFIG_DIR: dir, CLAUDE_SECURESTORAGE_CONFIG_DIR: dir };
}

/**
 * Look for a stored Claude login. `homeDir` / `platform` are injectable for
 * tests; production uses the real home dir and platform.
 */
export function detectStoredClaudeLogin(
  homeDir: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): StoredClaudeLogin {
  const credentialsPath = path.join(
    claudeConfigDir(homeDir),
    '.credentials.json',
  );

  let credentialsFile = false;
  try {
    credentialsFile = fs.existsSync(credentialsPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logToFile(
      `[stored-login] checked ${credentialsPath} — unreadable (${message}), treating as absent`,
    );
    analytics.wizardCapture('stored login check failed', {
      step: 'credentials-file',
    });
  }

  let keychain = false;
  if (platform === 'darwin') {
    try {
      // No `-w`: this returns only attributes (exit 0 if the item exists) and
      // never the password, so the stored token is not read or printed.
      const res = spawnSync(
        'security',
        ['find-generic-password', '-s', KEYCHAIN_SERVICE],
        { stdio: 'ignore', timeout: 5000 },
      );
      keychain = res.status === 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logToFile(
        `[stored-login] checked keychain '${KEYCHAIN_SERVICE}' — lookup cleared (${message}), treating as absent`,
      );
      analytics.wizardCapture('stored login check failed', {
        step: 'keychain',
      });
    }
  }

  return { credentialsFile, keychain };
}
