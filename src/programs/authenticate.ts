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
import { getOrAskForProjectData, type ProjectDataHost } from './project-data';
import { analytics, groupsFromUser } from '@utils/analytics';
import { logToFile } from '@utils/debug';

export type AuthProjection = {
  setCredentials(credentials: Credentials): void;
  setRoleAtOrganization(role: string | null): void;
  setApiUser(user: ApiUser | null): void;
};

/** Everything authentication needs from its host: the projection plus login display and abort. */
export type AuthHost = AuthProjection & ProjectDataHost;

/** Binds a UI object's auth methods into an AuthHost so each keeps its receiver. */
export function bindAuthHost(
  ui: Omit<AuthHost, 'abort'>,
  abort: AuthHost['abort'],
): AuthHost {
  return {
    log: {
      info: (message) => ui.log.info(message),
      warn: (message) => ui.log.warn(message),
      error: (message) => ui.log.error(message),
      success: (message) => ui.log.success(message),
    },
    spinner: () => ui.spinner(),
    setLoginUrl: (url) => ui.setLoginUrl(url),
    setAuthorizeUrl: (url) => ui.setAuthorizeUrl(url),
    waitForManualAuthCode: () => ui.waitForManualAuthCode(),
    showSessionTimeout: () => ui.showSessionTimeout(),
    showPortConflict: (processInfo) => ui.showPortConflict(processInfo),
    setCredentials: (credentials) => ui.setCredentials(credentials),
    setRoleAtOrganization: (role) => ui.setRoleAtOrganization(role),
    setApiUser: (user) => ui.setApiUser(user),
    abort,
  };
}

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
  authHost: AuthHost,
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
  } = await getOrAskForProjectData(
    {
      signup: session.signup,
      ci: session.ci,
      apiKey: session.apiKey,
      projectId: session.projectId,
      email: session.email,
      region: session.region,
      baseUrl: session.baseUrl,
      localMcp: session.localMcp,
      programId,
    },
    authHost,
  );

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

  authHost.setCredentials(session.credentials);
  authHost.setRoleAtOrganization(roleAtOrganization);
  authHost.setApiUser(user);

  // Identify the user (email, name) before flags are evaluated, so flags can
  // target the individual user and not just $app_name.
  if (user) analytics.identifyUser(user);
  analytics.setGroups(groupsFromUser(user, host.apiHost));
}
