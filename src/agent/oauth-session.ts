// The run's one OAuth token, shaped like gateway-session. The host supplies the rotation.

import type { Credentials } from '@shared/api';
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
// Shared so concurrent callers rotate once: a second rotation would spend the refresh token the first replaced.
let inFlight: Promise<Credentials> | null = null;
const listeners = new Set<(accessToken: string) => void>();
// Every access token this login has held; the first one names the login.
let lineage = new Set<string>();
let lineageRoot: string | undefined;

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
    onRefreshed?.(current);
    return;
  }
  if (!current || !sameLogin(current, credentials)) {
    lineage = new Set();
    lineageRoot = credentials.accessToken;
  }
  lineage.add(credentials.accessToken);
  current = credentials;
}

/** A key that stays the same across this login's rotations, so caches keyed on it survive one. */
export function oauthLoginKey(accessToken: string): string {
  return lineageRoot && lineage.has(accessToken) ? lineageRoot : accessToken;
}

/** The current credentials, refreshed first when near expiry or when `force` is set. */
export async function oauthCredentials(
  force = false,
): Promise<Credentials | null> {
  if (!current) return null;
  if (!rotate || !current.refreshToken || (!force && !nearExpiry(current)))
    return current;
  inFlight ??= refresh(rotate, current).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** The credentials to use now for this login, or the fallback when another login is held. */
export async function currentCredentials(
  fallback: Credentials,
  force = false,
): Promise<Credentials> {
  if (!current || !sameLogin(current, fallback)) return fallback;
  return (await oauthCredentials(force)) ?? fallback;
}

/** The access token to use now for this login. */
export async function currentAccessToken(
  fallback: Credentials,
): Promise<string> {
  return (await currentCredentials(fallback)).accessToken;
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
  lineage = new Set();
  lineageRoot = undefined;
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
  if (refreshed === credentials) return credentials;
  logToFile('[oauth-session] token rotated');
  lineage.add(refreshed.accessToken);
  current = refreshed;
  onRefreshed?.(refreshed);
  for (const listener of listeners) listener(refreshed.accessToken);
  return refreshed;
}
