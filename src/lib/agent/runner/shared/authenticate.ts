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
    projectId,
    cloudRegion,
    roleAtOrganization,
    user,
    project,
  } = await getOrAskForProjectData({
    signup: session.signup,
    ci: session.ci,
    apiKey: session.apiKey,
    projectId: session.projectId,
    email: session.email,
    region: session.region,
    baseUrl: session.baseUrl,
    programId,
  });

  session.credentials = { accessToken, projectApiKey, host, projectId };
  session.cloudRegion = cloudRegion;
  session.apiProject = project;
  session.roleAtOrganization = roleAtOrganization;
  session.apiUser = user;

  getUI().setCredentials(session.credentials);
  getUI().setRoleAtOrganization(roleAtOrganization);
  getUI().setApiUser(user);

  // Identify the user (email, name) before flags are evaluated, so flags can
  // target the individual user and not just $app_name.
  if (user) analytics.identifyUser(user);
  analytics.setGroups(groupsFromUser(user, host));
}
