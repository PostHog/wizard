#!/usr/bin/env node
/**
 * Prints a currently-valid gateway token, refreshing first when the one on disk
 * is nearly out. Installed as the SDK's `settings.apiKeyHelper` so a run that
 * outlives its one-hour token keeps working; see `rotating-credential.ts`.
 *
 * Its own build entry, because the SDK execs it as a standalone process.
 */

import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {
  AUTH_STATE_ENV,
  LOCK_STALE_MS,
  REFRESH_SKEW_MS,
} from './auth-constants';

interface AuthState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenUrl: string;
  clientId: string;
}

const statePath = process.env[AUTH_STATE_ENV]!;
const lockPath = `${statePath}.lock`;

const readState = (): AuthState => JSON.parse(readFileSync(statePath, 'utf8'));
const isHealthy = (state: AuthState): boolean =>
  state.expiresAt - Date.now() > REFRESH_SKEW_MS;

// PostHog rotates refresh tokens with reuse protection on, so two concurrent
// refreshes using the same token revoke every token in the session.
function tryLock(): boolean {
  try {
    mkdirSync(lockPath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
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

async function fetchNewToken(state: AuthState): Promise<string> {
  const response = await fetch(state.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: state.refreshToken,
      client_id: state.clientId,
    }),
  });
  if (!response.ok) throw new Error(`refresh returned HTTP ${response.status}`);
  const body = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const next: AuthState = {
    ...state,
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? state.refreshToken,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
  // Rename so the rotated refresh token is durable before we hand out the access
  // token it came with, and so no reader sees a half-written file.
  writeFileSync(`${statePath}.tmp`, JSON.stringify(next), { mode: 0o600 });
  renameSync(`${statePath}.tmp`, statePath);
  return next.accessToken;
}

const state = readState();
let token = state.accessToken;

if (!isHealthy(state) && tryLock()) {
  try {
    // Whoever held the lock before us may have already refreshed.
    const current = readState();
    token = isHealthy(current)
      ? current.accessToken
      : await fetchNewToken(current);
  } catch (err) {
    // Falling back to the token we have yields the same 401 the agent would have
    // hit without any of this, so a failed refresh never makes things worse.
    process.stderr.write(
      `[posthog-wizard] token refresh failed: ${(err as Error).message}\n`,
    );
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

process.stdout.write(token);
