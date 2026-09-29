/** The TUI's login: the browser OAuth flow, shown on the auth screen, as a credentials provider. */
import type {
  CredentialsProvider,
  ResolvedProgramCredentials,
  WizardSession,
} from '@programs/types';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import type { WizardStore } from '@tui/store';
import { getOrAskForProjectData } from './project-data.js';

/** Log in once through OAuth for the session's launch values; `scopeAdditions` wins over the program's own. */
export async function oauthLogin(
  session: WizardSession,
  programId: string,
  store: WizardStore,
  scopeAdditions?: readonly string[],
): Promise<ResolvedProgramCredentials> {
  logToFile('[login] starting OAuth');
  const data = await getOrAskForProjectData({
    store,
    signup: session.signup,
    ci: session.ci,
    apiKey: session.apiKey,
    projectId: session.projectId,
    email: session.email,
    region: session.region,
    baseUrl: session.baseUrl,
    localMcp: session.localMcp,
    programId,
    scopeAdditions,
  });
  analytics.wizardCapture('auth complete', { project_id: data.projectId });
  return {
    posthog: {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt,
      oauthClientId: data.oauthClientId,
      projectApiKey: data.projectApiKey,
      host: data.host,
      projectId: data.projectId,
      missingScopes: data.missingScopes,
    },
    project: data.project,
    apiUser: data.user,
    roleAtOrganization: data.roleAtOrganization,
  };
}

/** The OAuth login as `runProgram`'s provider, reading the store's session when it is asked. */
export function oauthCredentials(
  store: WizardStore,
  options: { scopeAdditions?: readonly string[] } = {},
): CredentialsProvider {
  return {
    resolve: (programId) =>
      oauthLogin(store.session, programId, store, options.scopeAdditions),
  };
}
