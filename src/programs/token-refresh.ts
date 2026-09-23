/** The pre-run OAuth token refresh, owned by programs and free of any session. */

import type { Credentials } from '@shared/api';
import { markGrantRevoked } from '@shared/auth-session-state';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import { OAuthError } from '@utils/oauth-errors';
import { refreshAccessToken } from '@utils/oauth-token';

// Below this remaining lifetime a run risks outliving its token; just-minted and 7-day tokens skip.
// Only a second agent run in one invocation can be this old — see self-driving's chained phases.
const REFRESH_WHEN_REMAINING_MS = 50 * 60 * 1000;

/**
 * Grants the token endpoint refuses permanently. A dead grant means the login
 * is gone, not that the network blipped, so only these mark the session.
 */
const DEAD_GRANT_CODES = new Set(['invalid_grant', 'invalid_client']);

/** Best-effort pre-run refresh; the same object comes back unless the token was refreshed. */
export async function refreshCredentialsIfNeeded(
  credentials: Credentials,
  options: { baseUrl?: string },
): Promise<Credentials> {
  if (!credentials.refreshToken) return credentials;

  // No expiry means we cannot tell how much life is left, so leave it alone —
  // refreshing every run would spend a rotation for nothing.
  if (credentials.expiresAt === undefined) return credentials;
  if (credentials.expiresAt - Date.now() >= REFRESH_WHEN_REMAINING_MS) {
    return credentials;
  }

  try {
    const token = await refreshAccessToken(
      credentials.refreshToken,
      options.baseUrl,
      credentials.oauthClientId,
    );
    // Replaced, not mutated: readers hold this object, and a new one keeps the
    // store and the (possibly shallow-copied) session explicitly in step.
    return {
      ...credentials,
      accessToken: token.access_token,
      // Rotation: keep the returned refresh token or the old one stops working.
      refreshToken: token.refresh_token ?? credentials.refreshToken,
      expiresAt: Date.now() + token.expires_in * 1000,
    };
  } catch (error) {
    // A dead grant is recorded but not thrown: the current token may still have
    // minutes of life, and failing here would break runs that would have worked.
    // If a 401 does follow, the auth-error screen can finally name the cause.
    if (error instanceof OAuthError && DEAD_GRANT_CODES.has(error.code)) {
      markGrantRevoked();
      analytics.wizardCapture('auth session expired', { reason: error.code });
    }
    logToFile(
      '[oauth] pre-run token refresh failed, continuing with the existing token:',
      error instanceof Error ? error.message : error,
    );
    return credentials;
  }
}
