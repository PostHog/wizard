/** Build a fixed CI bearer without mutating a gateway mint session. */
import { IS_PRODUCTION_BUILD } from '@env';
import { isTrustedGatewayUrl, type GatewayAuth } from './gateway-auth';

export function createCiGatewayAuth(
  token: string,
  projectId: number,
  gatewayUrl: string,
): GatewayAuth {
  if (IS_PRODUCTION_BUILD)
    throw new Error('CI gateway auth requires a non-production build');
  if (!token.trim() || !Number.isSafeInteger(projectId) || projectId <= 0) {
    throw new Error('CI gateway auth requires a token and valid project ID');
  }
  if (
    !/^https?:\/\//.test(gatewayUrl) ||
    !isTrustedGatewayUrl(gatewayUrl, '')
  ) {
    throw new Error('CI gateway auth requires a trusted gateway origin');
  }
  return {
    token: token.trim(),
    teamId: projectId,
    gatewayUrl: gatewayUrl.replace(/\/+$/, ''),
    refreshAtMs: Infinity,
  };
}
