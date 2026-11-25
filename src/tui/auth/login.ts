/** The TUI's login: the browser OAuth flow, shown on the auth screen, as a credentials provider. */
import type {
  CredentialsProvider,
  ResolvedProgramCredentials,
  WizardSession,
} from '@programs/types';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import type { WizardStore } from '@tui/store';
import { ErrorCodes, WizardError } from '@shared/errors';
import { abortOnScreens } from '@tui/abort';
import { getOrAskForProjectData } from './project-data.js';

/** Log in once through OAuth for the session's launch values. */
export async function oauthLogin(
  session: WizardSession,
  programId: string,
  store: WizardStore,
  completionScopeOptional?: boolean,
): Promise<ResolvedProgramCredentials> {
  logToFile('[agent-runner] starting OAuth');
  const data = await getOrAskForProjectData({
    store,
    projectId: session.projectId,
    baseUrl: session.baseUrl,
    localMcp: session.localMcp,
    programId,
    completionScopeOptional,
  }).catch(async (error: unknown) => {
    if (
      !(error instanceof WizardError) ||
      error.code !== ErrorCodes.AuthProjectFetchFailed
    )
      throw error;
    // Without this abort the error reaches the TUI host with no credentials set, which ends the run as completed.
    return abortOnScreens(store, {
      code: error.code,
      message: error.message,
      error,
    });
  });
  analytics.wizardCapture('auth complete', { project_id: data.projectId });
  return {
    posthog: {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt,
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
export function oauthCredentials(store: WizardStore): CredentialsProvider {
  return {
    resolve: (programId, { completionScopeOptional }) =>
      oauthLogin(store.session, programId, store, completionScopeOptional),
  };
}
