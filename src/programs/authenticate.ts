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

import type { ApiProject, ApiUser, Credentials } from '@shared/api';
import type { ProgramId } from '@programs/program-registry';
import type { CloudRegion } from '@utils/types';
import { getOrAskForProjectData } from '@utils/setup-utils';
import { analytics, groupsFromUser } from '@utils/analytics';
import { logToFile } from '@utils/debug';

export type AuthProjection = {
  setCredentials(credentials: Credentials): void;
  setRoleAtOrganization(role: string | null): void;
  setApiUser(user: ApiUser | null): void;
};

/** Authentication state shared with the CLI host, without TUI session fields. */
export interface AuthSession {
  signup: boolean;
  ci: boolean;
  apiKey?: string;
  projectId?: number;
  email?: string;
  region?: CloudRegion;
  baseUrl?: string;
  localMcp: boolean;
  credentials: Credentials | null;
  apiProject: ApiProject | null;
  roleAtOrganization: string | null;
  apiUser: ApiUser | null;
}

export async function authenticate(
  session: AuthSession,
  programId: ProgramId,
  projection: AuthProjection,
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

  projection.setCredentials(session.credentials);
  projection.setRoleAtOrganization(roleAtOrganization);
  projection.setApiUser(user);

  // Identify the user (email, name) before flags are evaluated, so flags can
  // target the individual user and not just $app_name.
  if (user) analytics.identifyUser(user);
  analytics.setGroups(groupsFromUser(user, host.apiHost));
}
