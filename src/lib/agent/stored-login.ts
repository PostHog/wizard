/**
 * Detect a pre-existing Claude Code login on the machine.
 *
 * The wizard authenticates the agent's LLM calls by injecting its PostHog OAuth
 * token via `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_AUTH_TOKEN`. But if the user
 * is already logged into Claude Code/Desktop, the Agent SDK can prefer that
 * stored `/login` credential (reported as `apiKeySource: "/login managed key"`)
 * and send it to the PostHog gateway instead — which rejects it with a 401,
 * since it's not a PostHog token.
 *
 * The settings-conflict scan ({@link checkAllSettingsConflicts}) only inspects
 * `settings.json` files for `ANTHROPIC_*` env overrides / `apiKeyHelper`; it has
 * no awareness of an actual logged-in session. This fills that gap: it checks
 * the two places the stored login lives so a run can log/report it.
 *
 * Existence-only: it never reads the credential value (no `-w`), so no secret is
 * ever exposed.
 *
 * The locations checked here mirror the SDK's own credential resolution. Source
 * (the bundled SDK we run — npmjs.com/package/@anthropic-ai/claude-agent-sdk):
 *   node_modules/@anthropic-ai/claude-agent-sdk@0.3.169 → sdk.mjs:
 *     const dir = opts?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR;
 *     const base = dir ?? join(home, ".claude");
 *     readFile(join(base, ".credentials.json"));   // ← credentials file
 *     if (!dir && !ANTHROPIC_API_KEY && !CLAUDE_CODE_OAUTH_TOKEN)
 *       readKeychain();                             // ← macOS keychain (only when CLAUDE_CONFIG_DIR is unset)
 * The `apiKeySource: "/login managed key"` label itself is emitted by the
 * compiled CLI the SDK extracts at runtime, not by this JS — so the exact
 * precedence (stored login vs CLAUDE_CODE_OAUTH_TOKEN) isn't visible in source
 * and is confirmed empirically via scripts/gateway-auth-probe.no-jest.ts.
 */
import * as fs from 'fs';
import * as os from 'os';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { logToFile } from '@utils/debug';
import { registerCleanup } from '@utils/wizard-abort';
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
 * Look for a stored Claude login. `homeDir` / `platform` are injectable for
 * tests; production uses the real home dir and platform.
 *
 * `configDir` defaults to the SDK's own resolution (CLAUDE_CONFIG_DIR, else
 * `~/.claude`). Pass it explicitly to look at the *real* config dir even after
 * the run has isolated CLAUDE_CONFIG_DIR (see {@link isolateClaudeConfigDir}).
 */
export function detectStoredClaudeLogin(
  homeDir: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
  configDir: string = process.env.CLAUDE_CONFIG_DIR ||
    path.join(homeDir, '.claude'),
): StoredClaudeLogin {
  const credentialsPath = path.join(configDir, '.credentials.json');
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

/**
 * Neutralize the conflict: point the agent's Claude config dir at a fresh,
 * empty throwaway directory so the SDK cannot resolve a stored `/login`
 * credential (file or keychain — keychain reads are skipped once
 * CLAUDE_CONFIG_DIR is set) and send it to the PostHog gateway. The wizard's
 * injected `CLAUDE_CODE_OAUTH_TOKEN` is unaffected. The caller sets
 * `process.env.CLAUDE_CONFIG_DIR` to the returned path. Registers best-effort
 * cleanup of the directory at process exit.
 */
export function isolateClaudeConfigDir(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'posthog-wizard-claude-config-'),
  );
  registerCleanup(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      logToFile(`[stored-login] failed to clean up isolated config dir ${dir}`);
      analytics.captureException(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  });
  return dir;
}
