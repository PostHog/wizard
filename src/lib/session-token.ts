/**
 * The run's access token, kept fresh.
 *
 * A leaf module on purpose. Two callers far apart need it: the agent bootstrap
 * refreshes right before it mints a gateway token, and the Self-driving GitHub
 * gate refreshes before it polls the PostHog API — a screen that runs *before*
 * the bootstrap and would otherwise poll with whatever token the earlier
 * integration phase left behind.
 */

import type { Credentials, WizardSession } from '@lib/wizard-session';
import { refreshAccessToken } from '@utils/oauth';
import { OAuthError } from '@utils/oauth-errors';
import { markGrantRevoked } from '@lib/auth-session-state';
import { analytics } from '@utils/analytics';
import { getUI } from '@ui';
import { logToFile } from '@utils/debug';

// Below this remaining lifetime a run risks outliving its token; just-minted and 7-day tokens skip.
// Only a second agent run in one invocation can be this old — see self-driving's chained phases.
const REFRESH_WHEN_REMAINING_MS = 50 * 60 * 1000;

/**
 * Grants the token endpoint refuses permanently. A dead grant means the login
 * is gone, not that the network blipped, so only these mark the session.
 */
const DEAD_GRANT_CODES = new Set(['invalid_grant', 'invalid_client']);

/**
 * Best-effort refresh: no refresh token or a failed grant keeps the existing
 * token. Returns true only when the token was replaced.
 *
 * `force` skips the remaining-lifetime check. Pass it when the server already
 * rejected the token, because then the expiry says nothing useful — a token can
 * be revoked long before it runs out.
 */
export async function refreshAccessTokenIfNeeded(
  session: WizardSession,
  options: { force?: boolean } = {},
): Promise<boolean> {
  const credentials = session.credentials;
  if (!credentials?.refreshToken) return false;

  if (!options.force) {
    // No expiry means we cannot tell how much life is left, so leave it alone —
    // refreshing every run would spend a rotation for nothing.
    if (credentials.expiresAt === undefined) return false;
    if (credentials.expiresAt - Date.now() >= REFRESH_WHEN_REMAINING_MS)
      return false;
  }

  try {
    const token = await refreshAccessToken(
      credentials.refreshToken,
      session.baseUrl,
      credentials.oauthClientId,
    );
    // Replaced, not mutated: readers hold this object, and a new one keeps the
    // store and the (possibly shallow-copied) session explicitly in step.
    const refreshed: Credentials = {
      ...credentials,
      accessToken: token.access_token,
      // Rotation: keep the returned refresh token or the old one stops working.
      refreshToken: token.refresh_token ?? credentials.refreshToken,
      expiresAt: Date.now() + token.expires_in * 1000,
    };
    session.credentials = refreshed;
    getUI().setAccessToken(refreshed);
    return true;
  } catch (error) {
    // A dead grant is recorded but not thrown: the current token may still have
    // minutes of life, and failing here would break runs that would have worked.
    // If a 401 does follow, the auth-error screen can finally name the cause.
    if (error instanceof OAuthError && DEAD_GRANT_CODES.has(error.code)) {
      markGrantRevoked();
      analytics.wizardCapture('auth session expired', { reason: error.code });
    }
    logToFile(
      '[oauth] token refresh failed, continuing with the existing token:',
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}
