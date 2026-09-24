/**
 * The run's PostHog OAuth credentials, shaped like gateway-session: one process-wide holder that
 * rotates near expiry, so the gateway re-mint, MCP and run sync all read the same token.
 * The host supplies the rotation; the agent never talks OAuth itself.
 */

import { createHash } from 'node:crypto';
import type { Credentials } from '@shared/api';
import { IS_DEV } from '@shared/constants';
import { logToFile } from '@utils/debug';

// Below this remaining lifetime a run risks outliving its token; just-minted and 7-day tokens skip.
const REFRESH_WHEN_REMAINING_MS = 50 * 60 * 1000;

/** Returns the rotated credentials, or the same object when the rotation failed. Never throws. */
export type RotateCredentials = (
  credentials: Credentials,
) => Promise<Credentials>;

let current: Credentials | null = null;
let rotate: RotateCredentials | undefined;
let onRefreshed: ((credentials: Credentials) => void) | undefined;
/** Shared so concurrent callers rotate once: a second rotation would spend the refresh token the first replaced. */
let inFlight: Promise<Credentials> | null = null;
const listeners = new Set<(accessToken: string) => void>();

/** Adopt the run's credentials; a stale copy of the held login gets the newer one back through `onRefreshed`. */
export function configureOAuthSession(
  credentials: Credentials,
  options: {
    rotate: RotateCredentials;
    onRefreshed?: (credentials: Credentials) => void;
  },
): void {
  rotate = options.rotate;
  onRefreshed = options.onRefreshed;
  if (
    current &&
    sameLogin(current, credentials) &&
    (current.expiresAt ?? 0) > (credentials.expiresAt ?? 0)
  ) {
    devLog(`configure kept newer ${describe(current)}`);
    onRefreshed?.(current);
    return;
  }
  devLog(`configure adopted ${describe(credentials)}`);
  current = credentials;
}

/** The current credentials, refreshed first when near expiry or when `force` is set. */
export async function oauthCredentials(
  force = false,
): Promise<Credentials | null> {
  if (!current) return null;
  if (!rotate || !current.refreshToken || (!force && !nearExpiry(current)))
    return current;
  if (inFlight) {
    devLog('refresh joined the one in flight');
    return inFlight;
  }
  devLog(
    `refresh start (${force ? 'forced' : 'near expiry'}) ${describe(current)}`,
  );
  inFlight = refresh(rotate, current).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** The credentials to use now for this login, or the fallback when another login is held. */
export async function currentCredentials(
  fallback: Credentials,
  force = false,
  reader = 'run-sync',
): Promise<Credentials> {
  if (!current || !sameLogin(current, fallback)) {
    devLog(`${reader} reads its own credentials, no session for this login`);
    return fallback;
  }
  const credentials = (await oauthCredentials(force)) ?? fallback;
  devLog(`${reader} reads token ${fingerprint(credentials.accessToken)}`);
  return credentials;
}

/** The access token to use now for this login; `reader` labels the dev log. */
export async function currentAccessToken(
  fallback: Credentials,
  reader: string,
): Promise<string> {
  return (await currentCredentials(fallback, false, reader)).accessToken;
}

/** Called with each new access token after a rotation. Returns the unsubscribe. */
export function onAccessTokenRotated(
  listener: (accessToken: string) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test hook: drop the held credentials so the next run configures afresh. */
export function resetOAuthSession(): void {
  current = null;
  rotate = undefined;
  onRefreshed = undefined;
  inFlight = null;
  listeners.clear();
}

function sameLogin(a: Credentials, b: Credentials): boolean {
  return a.host.apiHost === b.host.apiHost && a.projectId === b.projectId;
}

function nearExpiry(credentials: Credentials): boolean {
  // No expiry means we cannot tell how much life is left, so leave it alone.
  return (
    credentials.expiresAt !== undefined &&
    credentials.expiresAt - Date.now() < REFRESH_WHEN_REMAINING_MS
  );
}

async function refresh(
  rotateWith: RotateCredentials,
  credentials: Credentials,
): Promise<Credentials> {
  const refreshed = await rotateWith(credentials);
  if (refreshed === credentials) {
    devLog(`refresh failed, keeping ${describe(credentials)}`);
    return credentials;
  }
  devLog(
    `refreshed ${fingerprint(credentials.accessToken)} -> ${describe(
      refreshed,
    )}, refresh token ${
      refreshed.refreshToken === credentials.refreshToken ? 'kept' : 'rotated'
    }`,
  );
  current = refreshed;
  onRefreshed?.(refreshed);
  for (const listener of listeners) listener(refreshed.accessToken);
  return refreshed;
}

// Dev builds only; a short hash tells tokens apart without logging one.
function devLog(message: string): void {
  if (IS_DEV) logToFile(`[oauth-session] ${message}`);
}

function fingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 8);
}

function describe(credentials: Credentials): string {
  const ttl =
    credentials.expiresAt === undefined
      ? 'no expiry'
      : `${Math.round((credentials.expiresAt - Date.now()) / 1000)}s left`;
  return `token ${fingerprint(credentials.accessToken)} (${ttl})`;
}
