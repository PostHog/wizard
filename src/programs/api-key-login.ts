/** Log in with a personal API key, the way `--ci` does: no browser, no OAuth. */

import {
  resolveApiKeyProject,
  type ApiKeyLoginOptions,
} from '@shared/api-key-login';
import type {
  CredentialsProvider,
  ResolvedProgramCredentials,
} from './credentials';

export type { ApiKeyLoginOptions };

/** The login for `apiKey`, plus the user's role for role-tailored copy. */
export async function resolveApiKeyLogin(
  apiKey: string,
  options: ApiKeyLoginOptions = {},
): Promise<ResolvedProgramCredentials & { roleAtOrganization: string | null }> {
  const { host, project, apiUser } = await resolveApiKeyProject(
    apiKey,
    options,
  );
  return {
    posthog: {
      accessToken: apiKey,
      projectApiKey: project.api_token,
      host,
      projectId: project.id,
      // A personal API key carries whatever scopes it carries — there is no
      // per-run scope request to diff against.
      missingScopes: [],
    },
    project,
    apiUser,
    roleAtOrganization: apiUser?.role_at_organization ?? null,
  };
}

/** A credentials provider that logs in with `apiKey` once, on first use. */
export function apiKeyCredentials(
  apiKey: string,
  options: ApiKeyLoginOptions = {},
): CredentialsProvider {
  let login: Promise<ResolvedProgramCredentials> | undefined;
  return {
    resolve: () => (login ??= resolveApiKeyLogin(apiKey, options)),
  };
}
