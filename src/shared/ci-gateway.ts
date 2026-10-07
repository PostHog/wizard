import { readFileSync } from 'node:fs';
import { IS_PRODUCTION_BUILD, runtimeEnv } from '@env';
import type { GatewayCredential } from '@shared/api';
import type { CloudRegion } from '@utils/types';

/** The pre-issued gateway token a dev or test `--ci` run uses, read once and then cleared from the environment. */
export function readCiGatewayCredential(
  region: CloudRegion,
): GatewayCredential {
  if (IS_PRODUCTION_BUILD)
    throw new Error('CI gateway auth requires a non-production build');
  const path = runtimeEnv('WIZARD_CI_GATEWAY_TOKEN_FILE');
  if (!path) throw new Error('WIZARD_CI_GATEWAY_TOKEN_FILE is required for CI');
  const token = readFileSync(path, 'utf8');
  delete process.env.WIZARD_CI_GATEWAY_TOKEN_FILE;
  return {
    token,
    url:
      runtimeEnv('WIZARD_CI_GATEWAY_URL') ||
      `https://ai-gateway.${region}.posthog.com`,
  };
}
