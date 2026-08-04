/**
 * A gateway credential the running agent can pick up fresh.
 *
 * Wizard access tokens live one hour (the OAuth app isn't first-party or
 * dynamically registered, so it gets the strict default TTL). The agent runs as
 * one long-lived subprocess whose env is fixed at spawn, so a token injected via
 * `ANTHROPIC_AUTH_TOKEN` can't be replaced once it goes stale — any run past the
 * hour dies on a 401. A `wizard_ask` that nobody answers makes that easy to hit:
 * the agent sits idle through its own token's expiry and only finds out when it
 * resumes.
 *
 * So instead of a fixed token we hand the SDK `settings.apiKeyHelper`, a script
 * it re-runs on its own cadence. The script refreshes when the token is nearly
 * out and prints whatever is currently valid, which keeps the access-token
 * window at an hour rather than widening it.
 *
 * Everything lives in a private temp dir the caller removes at exit. The refresh
 * token is a real credential, hence 0600 and a directory only the user can enter.
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

/**
 * How long the SDK may cache one helper result, as
 * `CLAUDE_CODE_API_KEY_HELPER_TTL_MS`.
 */
export const HELPER_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Refresh once the token has less than this left. Must stay comfortably wider
 * than {@link HELPER_CACHE_TTL_MS}: a result cached for the full window has to
 * still be valid when the window ends, so the gap between the two is the real
 * safety margin.
 */
const REFRESH_SKEW_MS = 15 * 60 * 1000;

/** A lock older than this belonged to a process that died holding it. */
const LOCK_STALE_MS = 30 * 1000;

/**
 * Runs as its own process, so it gets no bundler and no dependencies — Node
 * built-ins and global `fetch` only. Reads its state file as a sibling rather
 * than an argument, because a shebang can't portably pass one.
 *
 * The lock matters more than it looks: PostHog rotates refresh tokens and
 * enforces reuse protection, so two concurrent refreshes with the same token
 * revoke every token in the session.
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

/** Take the lock, or report that someone else holds it. Steals an orphan. */
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
    // Lost a race to steal it, or the holder released it first. Either way
    // someone else is on it.
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
  // Rename so a reader never sees a half-written file, and so the rotated
  // refresh token is durable before we hand out the access token it came with.
  const tmpPath = statePath + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(next), { mode: 0o600 });
  renameSync(tmpPath, statePath);
  return next.accessToken;
}

const state = readState();
let token = state.accessToken;

// Only contend for the lock when a refresh is actually due — the common case is
// a healthy token and a plain read.
if (!isHealthy(state) && tryLock()) {
  try {
    // Re-read: whoever held the lock before us may have already refreshed.
    const current = readState();
    token = isHealthy(current) ? current.accessToken : await fetchNewToken(current);
  } catch (err) {
    // Fall back to what we have. If it really is expired the agent gets the same
    // 401 it would have got without any of this, so don't make it worse.
    process.stderr.write('[posthog-wizard] token refresh failed: ' + err.message + '\\n');
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

process.stdout.write(token);
`;

/** Writes the helper and its state, returning the path to run. */
export function createRotatingCredential(
  input: RotatingCredentialInput,
): string {
  // mkdtemp already creates the directory 0700.
  const dir = mkdtempSync(path.join(tmpdir(), 'posthog-wizard-auth-'));
  const helperPath = path.join(dir, 'helper.mjs');

  writeFileSync(path.join(dir, 'state.json'), JSON.stringify(input), {
    mode: 0o600,
  });
  // Executable, and pinned to the Node already running us rather than to
  // whatever PATH the SDK resolves the helper against.
  writeFileSync(helperPath, helperSource(), { mode: 0o700 });

  registerCleanup(() => rmSync(dir, { recursive: true, force: true }));
  return helperPath;
}

/**
 * One per process, because every caller shares the invocation's single OAuth
 * session. Two credentials would mean two state files holding the same refresh
 * token, and the lock only serializes within a file — parallel orchestrator
 * tasks would then refresh concurrently and reuse protection would revoke the
 * whole session.
 */
let shared: string | undefined;

export function getRotatingCredential(input: RotatingCredentialInput): string {
  shared ??= createRotatingCredential(input);
  return shared;
}
