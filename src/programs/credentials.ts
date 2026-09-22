/** Resolved credentials passed from a program host to one agent run. */

import { gatewayAuth } from '@agent';
import type { GatewayAuth, InferenceAuthProvider } from '@agent/types';
import type { ApiProject, ApiUser, Credentials } from '@shared/api';

export type ResolvedProgramCredentials = {
  posthog: Credentials;
  inferenceAuth: InferenceAuthProvider;
  project: ApiProject | null;
  apiUser: ApiUser | null;
};

/** Hosts authenticate once per scope and may return refreshed credentials. */
export type CredentialsProvider = {
  resolve(programId: string): Promise<ResolvedProgramCredentials>;
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
