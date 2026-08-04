/**
 * Installs the credential helper for a run.
 *
 * Wizard access tokens live one hour, and the agent subprocess has its env fixed
 * at spawn, so a token injected via `ANTHROPIC_AUTH_TOKEN` can never be replaced
 * and any run past the hour dies on a 401. Pointing the SDK at a re-runnable
 * `settings.apiKeyHelper` keeps the access-token window at an hour rather than
 * widening it. The helper itself is `auth-helper.ts`, its own build entry.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerCleanup } from '@utils/wizard-abort';

export interface RotatingCredentialInput {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms the access token expires. */
  expiresAt: number;
  tokenUrl: string;
  clientId: string;
}

/** Sibling of the bundle in `dist`, which is what dev and published runs both use. */
export const AUTH_HELPER_PATH = fileURLToPath(
  new URL('./auth-helper.js', import.meta.url),
);

/** Writes the run's token state, returning the path to point the helper at. */
export function createAuthState(input: RotatingCredentialInput): string {
  // mkdtemp creates the directory 0700, which the refresh token inside needs.
  const dir = mkdtempSync(path.join(tmpdir(), 'posthog-wizard-auth-'));
  const statePath = path.join(dir, 'state.json');
  writeFileSync(statePath, JSON.stringify(input), { mode: 0o600 });
  registerCleanup(() => rmSync(dir, { recursive: true, force: true }));
  return statePath;
}

/**
 * One per process, because the helper's lock only serializes within a single
 * state file. Two states would hold the same refresh token, so parallel
 * orchestrator tasks could refresh concurrently.
 */
let shared: string | undefined;

export function getAuthStatePath(input: RotatingCredentialInput): string {
  shared ??= createAuthState(input);
  return shared;
}
