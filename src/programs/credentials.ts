/** Resolved credentials passed from a program host to one agent run. */

import type { ApiProject, ApiUser, Credentials } from '@shared/api';

export type ResolvedProgramCredentials = {
  posthog: Credentials;
  project: ApiProject | null;
  apiUser: ApiUser | null;
};

/** Hosts authenticate once per scope; the signal aborts with the invocation. */
export type CredentialsProvider = {
  resolve(
    programId: string,
    context: { signal: AbortSignal },
  ): Promise<ResolvedProgramCredentials>;
};
