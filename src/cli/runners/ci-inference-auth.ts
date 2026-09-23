/** CI owns the token-file input and hands a fixed bearer to the program. */

import { readFileSync } from 'node:fs';
import { createCiGatewayAuth } from '@shared/gateway/ci-gateway-auth';
import type { InferenceAuthProvider } from '@agent/types';
import { IS_PRODUCTION_BUILD, runtimeEnv } from '@env';
import type { CloudRegion } from '@utils/types';

export function loadCiInferenceAuthProvider(
  projectId: number,
  region: CloudRegion,
): InferenceAuthProvider {
  if (IS_PRODUCTION_BUILD)
    throw new Error('CI gateway auth requires a non-production build');
  const tokenFile = runtimeEnv('WIZARD_CI_GATEWAY_TOKEN_FILE');
  if (!tokenFile)
    throw new Error('WIZARD_CI_GATEWAY_TOKEN_FILE is required for CI');
  const token = readFileSync(tokenFile, 'utf8');
  delete process.env.WIZARD_CI_GATEWAY_TOKEN_FILE;
  const gatewayUrl =
    runtimeEnv('WIZARD_CI_GATEWAY_URL') ||
    `https://ai-gateway.${region}.posthog.com`;
  const auth = createCiGatewayAuth(token, projectId, gatewayUrl);
  return { resolve: () => Promise.resolve(auth) };
}

/** Let a screen-only CI host start before a gateway bearer is needed. */
export function createLazyCiInferenceAuthProvider(
  projectId: number,
  region: CloudRegion,
): InferenceAuthProvider {
  let provider: InferenceAuthProvider | undefined;
  return {
    resolve: async () => {
      provider ??= loadCiInferenceAuthProvider(projectId, region);
      return provider.resolve();
    },
  };
}
