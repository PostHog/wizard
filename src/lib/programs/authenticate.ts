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
import { refreshAccessToken, missingOAuthScopes } from '@utils/oauth';
import { WIZARD_OAUTH_SCOPES } from '@shared/constants';
import { OAuthError } from '@utils/oauth-errors';
import { markGrantRevoked } from '@shared/auth-session-state';
import { configureOAuthSession, oauthCredentials } from '@shared/oauth-session';
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

/**
 * Grants the token endpoint refuses permanently. A dead grant means the login
 * is gone, not that the network blipped, so only these mark the session.
 */
const DEAD_GRANT_CODES = new Set(['invalid_grant', 'invalid_client']);

// Pre-run refresh through the run's OAuth session, so every later reader shares its rotations.
export async function refreshAccessTokenIfNeeded(
  session: WizardSession,
): Promise<void> {
  if (!session.credentials) return;
  configureOAuthSession(session.credentials, {
    rotate: (credentials) => rotateCredentials(credentials, session.baseUrl),
    onRefreshed: (refreshed) => {
      // Replaced, not mutated: keeps the store and the (possibly shallow-copied) session in step.
      session.credentials = refreshed;
      getUI().setAccessToken(refreshed);
    },
  });
  await oauthCredentials();
}

// One refresh-token grant. A failure returns the same credentials: the old token may still have minutes of life.
async function rotateCredentials(
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
