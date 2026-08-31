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

import type { WizardSession } from '@lib/wizard-session';
import type { ProgramId } from '@lib/programs/program-registry';
import { getOrAskForProjectData } from '@utils/setup-utils';
import { refreshAccessToken } from '@utils/oauth';
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

// The agent subprocess freezes its token at spawn and a run can block on a wizard_ask
// for the rest of the token's life, so each run must start near-full; skip only
// just-minted 1-hour tokens and long-lived (7-day first-party) grants.
const REFRESH_WHEN_REMAINING_MS = 50 * 60 * 1000;

/**
 * Mint a fresh access token before an agent run when the current one has aged.
 * Best-effort: refresh-less credentials (CI api keys) and failed refreshes
 * leave the existing token in place, so behavior degrades to the status quo.
 */
export async function refreshAccessTokenIfNeeded(
  session: WizardSession,
): Promise<void> {
  const credentials = session.credentials;
  if (!credentials?.refreshToken) return;

  const remaining = (credentials.expiresAt ?? 0) - Date.now();
  if (remaining >= REFRESH_WHEN_REMAINING_MS) return;

  try {
    const token = await refreshAccessToken(
      credentials.refreshToken,
      session.baseUrl,
    );
    credentials.accessToken = token.access_token;
    // Rotation: keep the returned refresh token or the old one stops working.
    credentials.refreshToken = token.refresh_token ?? credentials.refreshToken;
    credentials.expiresAt = Date.now() + token.expires_in * 1000;
    getUI().setCredentials(credentials);
  } catch (error) {
    logToFile(
      '[oauth] pre-run token refresh failed, continuing with the existing token:',
      error instanceof Error ? error.message : error,
    );
  }
}
