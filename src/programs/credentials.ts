/** Resolved credentials passed from a program host to one agent run. */

import { gatewayAuth } from './gateway-session';
import type { InferenceAuthProvider } from '@agent/types';
import type { GatewayAuth } from '@shared/gateway-auth';
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
  return {
    resolve: (): Promise<GatewayAuth> =>
      gatewayAuth(posthog.host, posthog.accessToken, programId),
  };
}
