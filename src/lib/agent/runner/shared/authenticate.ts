/**
 * Authenticate the wizard — once per invocation.
 *
 * Idempotent: when `session.credentials` is already set, this is a no-op. So a
 * second agent run in the same invocation (e.g. self-driving runs the
 * integration program as a phase, then the Self-driving run) reuses the first
 * login instead of launching another OAuth — a second OAuth re-prompts and
 * fails with a 400 (the first authorization code is already spent). The first
 * call stores the full result on the session so any later bootstrap reads it
 * back rather than fetching again.
 */

import type { Credentials, WizardSession } from '@lib/wizard-session';
import type { ProgramId } from '@lib/programs/program-registry';
import { getOrAskForProjectData } from '@utils/setup-utils';
import { refreshAccessToken } from '@utils/oauth';
import { OAuthError } from '@utils/oauth-errors';
import { markGrantRevoked } from '@lib/auth-session-state';
import { analytics, groupsFromUser } from '@utils/analytics';
import { getUI } from '@ui';
import { logToFile } from '@utils/debug';

export async function authenticate(
  session: WizardSession,
  programId: ProgramId,
): Promise<void> {
  if (session.credentials) return;

  logToFile('[agent-runner] starting OAuth');
  const {
    projectApiKey,
    host,
    accessToken,
    refreshToken,
    expiresAt,
    oauthClientId,
    projectId,
    roleAtOrganization,
    user,
    project,
    missingScopes,
  } = await getOrAskForProjectData({
    signup: session.signup,
    ci: session.ci,
    apiKey: session.apiKey,
    projectId: session.projectId,
    email: session.email,
    region: session.region,
    baseUrl: session.baseUrl,
    localMcp: session.localMcp,
    programId,
  });

  session.credentials = {
    accessToken,
    refreshToken,
    expiresAt,
    oauthClientId,
    projectApiKey,
    host,
    projectId,
    missingScopes,
  };
  session.apiProject = project;
  session.roleAtOrganization = roleAtOrganization;
  session.apiUser = user;

  getUI().setCredentials(session.credentials);
  getUI().setRoleAtOrganization(roleAtOrganization);
  getUI().setApiUser(user);

  // Identify the user (email, name) before flags are evaluated, so flags can
  // target the individual user and not just $app_name.
  if (user) analytics.identifyUser(user);
  analytics.setGroups(groupsFromUser(user, host.apiHost));
}

// Below this remaining lifetime a run risks outliving its token; just-minted and 7-day tokens skip.
// Only a second agent run in one invocation can be this old — see self-driving's chained phases.
const REFRESH_WHEN_REMAINING_MS = 50 * 60 * 1000;

/**
 * Grants the token endpoint refuses permanently. A dead grant means the login
 * is gone, not that the network blipped, so only these mark the session.
 */
const DEAD_GRANT_CODES = new Set(['invalid_grant', 'invalid_client']);

// Best-effort pre-run refresh: no refresh token or a failed grant keeps the existing token.
export async function refreshAccessTokenIfNeeded(
  session: WizardSession,
): Promise<void> {
  const credentials = session.credentials;
  if (!credentials?.refreshToken) return;

  // No expiry means we cannot tell how much life is left, so leave it alone —
  // refreshing every run would spend a rotation for nothing.
  if (credentials.expiresAt === undefined) return;
  if (credentials.expiresAt - Date.now() >= REFRESH_WHEN_REMAINING_MS) return;

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
  }
}
