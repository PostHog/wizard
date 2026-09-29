/** The invocation's login: the caller's, the store's, or a provider's, recorded in the store. */
import { analytics, groupsFromUser } from '@utils/analytics';
import type {
  CredentialsProvider,
  ResolvedProgramCredentials,
} from './credentials';
import type { SessionStore } from './session/session-store';

/**
 * Log in for `programId` once per store: a login the caller holds wins, then
 * the store's, then `provider`'s. A new login is written to the store, and the
 * user is identified so feature flags can target them.
 */
export async function logIn(
  programId: string,
  store: SessionStore,
  options: {
    credentials?: ResolvedProgramCredentials;
    provider?: CredentialsProvider;
    signal: AbortSignal;
  },
): Promise<ResolvedProgramCredentials> {
  const held = store.session.credentials;
  let login: ResolvedProgramCredentials | undefined =
    options.credentials ??
    (held
      ? {
          posthog: held,
          project: store.session.apiProject,
          apiUser: store.session.apiUser,
        }
      : undefined);
  if (!login && options.provider) {
    login = await options.provider.resolve(programId, {
      signal: options.signal,
    });
  }
  if (!login) {
    throw new Error(`Credentials are required to run ${programId}.`);
  }
  // A dev or test `--ci` run carries a pre-issued gateway token on its login.
  const gateway = store.session.ciGateway;
  if (gateway && !login.posthog.gateway) {
    login = { ...login, posthog: { ...login.posthog, gateway } };
  }
  if (login.posthog !== held) {
    store.setLogin({
      posthog: login.posthog,
      project: login.project,
      apiUser: login.apiUser,
      roleAtOrganization: login.roleAtOrganization,
    });
  }
  if (login.apiUser) analytics.identifyUser(login.apiUser);
  analytics.setGroups(
    groupsFromUser(login.apiUser, login.posthog.host.apiHost),
  );
  return login;
}
