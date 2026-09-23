/** Resolved credentials passed from a program host to one agent run. */

import { gatewayAuth } from './gateway-session';
import type { GatewayAuth, InferenceAuthProvider } from '@agent/types';
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

/**
 * Program-owned first-party inference auth. Resolving each time preserves the
 * gateway session's cache and near-expiry refresh for long agent runs.
 */
export function createPosthogInferenceAuthProvider(
  posthog: Credentials,
  programId: string,
): InferenceAuthProvider {
  if (!programId) throw new Error('Inference auth requires a program id');
  return {
    resolve: (): Promise<GatewayAuth> =>
      gatewayAuth(posthog.host, posthog.accessToken, programId),
  };
}
