/**
 * A gateway credential the running agent can pick up fresh.
 *
 * Wizard access tokens live one hour, and the agent subprocess has its env fixed
 * at spawn, so a token injected via `ANTHROPIC_AUTH_TOKEN` can never be replaced
 * and any run past the hour dies on a 401. Handing the SDK a re-runnable
 * `settings.apiKeyHelper` instead keeps the access-token window at an hour
 * rather than widening it.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerCleanup } from '@utils/wizard-abort';

export interface RotatingCredentialInput {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms the access token expires. */
  expiresAt: number;
  tokenUrl: string;
  clientId: string;
}

/** Set as `CLAUDE_CODE_API_KEY_HELPER_TTL_MS`. */
export const HELPER_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Must stay wider than {@link HELPER_CACHE_TTL_MS}, because a result cached for
 * the full window has to still be valid when that window ends.
 */
const REFRESH_SKEW_MS = 15 * 60 * 1000;

/** A lock older than this belonged to a process that died holding it. */
const LOCK_STALE_MS = 30 * 1000;

/**
 * Runs as its own process, so no bundler and no dependencies: Node built-ins and
 * global `fetch` only. It locates its state file as a sibling because a shebang
 * cannot portably pass an argument.
 */
const helperSource = (): string => `#!${process.execPath}
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const statePath = fileURLToPath(new URL('./state.json', import.meta.url));
const lockPath = statePath + '.lock';
const REFRESH_SKEW_MS = ${REFRESH_SKEW_MS};
const LOCK_STALE_MS = ${LOCK_STALE_MS};

const readState = () => JSON.parse(readFileSync(statePath, 'utf8'));
const isHealthy = (state) => state.expiresAt - Date.now() > REFRESH_SKEW_MS;

// PostHog rotates refresh tokens with reuse protection on, so two concurrent
// refreshes using the same token revoke every token in the session.
function tryLock() {
  try {
    mkdirSync(lockPath);
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  try {
    if (Date.now() - statSync(lockPath).mtimeMs < LOCK_STALE_MS) return false;
    rmSync(lockPath, { recursive: true, force: true });
    mkdirSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

async function fetchNewToken(state) {
  const response = await fetch(state.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: state.refreshToken,
      client_id: state.clientId,
    }),
  });
  if (!response.ok) throw new Error('refresh returned HTTP ' + response.status);
  const body = await response.json();

  const next = {
    ...state,
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? state.refreshToken,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
  // Rename so the rotated refresh token is durable before we hand out the access
  // token it came with, and so no reader sees a half-written file.
  const tmpPath = statePath + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(next), { mode: 0o600 });
  renameSync(tmpPath, statePath);
  return next.accessToken;
}

const state = readState();
let token = state.accessToken;

if (!isHealthy(state) && tryLock()) {
  try {
    // Whoever held the lock before us may have already refreshed.
    const current = readState();
    token = isHealthy(current) ? current.accessToken : await fetchNewToken(current);
  } catch (err) {
    // Falling back to the token we have yields the same 401 the agent would have
    // hit without any of this, so a failed refresh never makes things worse.
    process.stderr.write('[posthog-wizard] token refresh failed: ' + err.message + '\\n');
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

process.stdout.write(token);
`;

export function createRotatingCredential(
  input: RotatingCredentialInput,
): string {
  // mkdtemp creates the directory 0700, which the refresh token inside needs.
  const dir = mkdtempSync(path.join(tmpdir(), 'posthog-wizard-auth-'));
  const helperPath = path.join(dir, 'helper.mjs');

  writeFileSync(path.join(dir, 'state.json'), JSON.stringify(input), {
    mode: 0o600,
  });
  // Pinned to the Node already running us, because the SDK resolves the helper
  // against a PATH that may not have one.
  writeFileSync(helperPath, helperSource(), { mode: 0o700 });

  registerCleanup(() => rmSync(dir, { recursive: true, force: true }));
  return helperPath;
}

/**
 * One per process, because the lock above only serializes within a single state
 * file. Two credentials would mean two files holding the same refresh token, so
 * parallel orchestrator tasks could refresh concurrently.
 */
let shared: string | undefined;

export function getRotatingCredential(input: RotatingCredentialInput): string {
  shared ??= createRotatingCredential(input);
  return shared;
}
