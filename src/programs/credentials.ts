/** Resolved credentials runProgram passes to one agent run. */

import type { ApiProject, ApiUser, Credentials } from '@shared/api';

export type ResolvedProgramCredentials = {
  posthog: Credentials; // token, project API key, project ID and host
  project: ApiProject | null; // the project, when known
  apiUser: ApiUser | null; // the user, when known
};

/** The caller authenticates once per scope; the signal aborts with the invocation. */
export type CredentialsProvider = {
  resolve(
    programId: string,
    context: { signal: AbortSignal },
  ): Promise<ResolvedProgramCredentials>;
};
