/** Resolved credentials passed from a program host to one agent run. */
/* eslint-disable @typescript-eslint/no-unused-vars -- A shell: B3 fills in the body. */

import type { InferenceAuthProvider } from '@agent/types';
import type { ApiProject, ApiUser, Credentials } from '@shared/api';

export type ResolvedProgramCredentials = {
  posthog: Credentials;
  /** When absent, runProgram mints first-party gateway auth from the refreshed login. */
  inferenceAuth?: InferenceAuthProvider;
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

/** First-party inference auth; each resolve reuses the gateway session's cache and near-expiry refresh. */
export function createPosthogInferenceAuthProvider(
  posthog: Credentials,
  programId: string,
): InferenceAuthProvider {
  throw new Error('createPosthogInferenceAuthProvider: not implemented');
}
