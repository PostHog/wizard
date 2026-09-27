/** Resolved credentials runProgram passes to one agent run, and the grant that rotates them. */

import type { ApiProject, ApiUser, Credentials } from '@shared/api';
import { WIZARD_OAUTH_SCOPES } from '@shared/constants';
import { markGrantRevoked } from '@shared/auth-session-state';
import { missingOAuthScopes, refreshAccessToken } from '@utils/oauth';
import { OAuthError } from '@utils/oauth-errors';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';

export type ResolvedProgramCredentials = {
  posthog: Credentials; // token, project API key, project ID and host
  project: ApiProject | null; // the project, when known
  apiUser: ApiUser | null; // the user, when known
};

/** The caller authenticates once per scope; the signal aborts with the invocation. */
export type CredentialsProvider = {
  resolve(
    programId: string,
    context: { signal: AbortSignal },
  ): Promise<ResolvedProgramCredentials>;
};

/**
 * Grants the token endpoint refuses permanently. A dead grant means the login
 * is gone, not that the network blipped, so only these mark the session.
 */
const DEAD_GRANT_CODES = new Set(['invalid_grant', 'invalid_client']);

// One refresh-token grant. A failure returns the same credentials: the old token may still have minutes of life.
export async function rotateCredentials(
  credentials: Credentials,
  baseUrl: string | undefined,
): Promise<Credentials> {
  if (!credentials.refreshToken) return credentials;
  try {
    const token = await refreshAccessToken(
      credentials.refreshToken,
      baseUrl,
      credentials.oauthClientId,
    );
    return {
      ...credentials,
      accessToken: token.access_token,
      missingScopes: missingOAuthScopes(
        [...WIZARD_OAUTH_SCOPES, ...(credentials.missingScopes ?? [])],
        token.scope,
      ),
      // Rotation: keep the returned refresh token or the old one stops working.
      refreshToken: token.refresh_token ?? credentials.refreshToken,
      expiresAt: Date.now() + token.expires_in * 1000,
    };
  } catch (error) {
    // A dead grant is recorded but not thrown. If a 401 does follow, the auth-error screen can name the cause.
    if (error instanceof OAuthError && DEAD_GRANT_CODES.has(error.code)) {
      markGrantRevoked();
      analytics.wizardCapture('auth session expired', { reason: error.code });
    }
    logToFile(
      '[oauth] token refresh failed, continuing with the existing token:',
      error instanceof Error ? error.message : error,
    );
    return credentials;
  }
}
