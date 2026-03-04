import axios from 'axios';
import { IS_DEV, WIZARD_USER_AGENT } from '../lib/constants';
import type { CloudRegion } from './types';

export const getAssetHostFromHost = (host: string) => {
  if (host.includes('us.i.posthog.com')) {
    return 'https://us-assets.i.posthog.com';
  }

  if (host.includes('eu.i.posthog.com')) {
    return 'https://eu-assets.i.posthog.com';
  }

  return host;
};

export const getUiHostFromHost = (host: string) => {
  if (host.includes('us.i.posthog.com')) {
    return 'https://us.posthog.com';
  }

  if (host.includes('eu.i.posthog.com')) {
    return 'https://eu.posthog.com';
  }

  return host;
};

export const getHostFromRegion = (region: CloudRegion) => {
  if (IS_DEV) {
    return 'http://localhost:8010';
  }

  if (region === 'eu') {
    return 'https://eu.i.posthog.com';
  }

  return 'https://us.i.posthog.com';
};

export const getCloudUrlFromRegion = (region: CloudRegion) => {
  if (IS_DEV) {
    return 'http://localhost:8010';
  }

  if (region === 'eu') {
    return 'https://eu.posthog.com';
  }

  return 'https://us.posthog.com';
};

export async function detectRegionFromToken(
  accessToken: string,
): Promise<CloudRegion> {
  if (IS_DEV) {
    return 'us';
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': WIZARD_USER_AGENT,
  };

  const [usResult, euResult] = await Promise.allSettled([
    axios.get('https://us.posthog.com/api/users/@me/', { headers }),
    axios.get('https://eu.posthog.com/api/users/@me/', { headers }),
  ]);

  if (usResult.status === 'fulfilled') return 'us';
  if (euResult.status === 'fulfilled') return 'eu';

  throw new Error(
    'Could not determine cloud region from access token. Please check your PostHog account.',
  );
}

export const getLlmGatewayUrlFromHost = (host: string) => {
  if (host.includes('localhost')) {
    return 'http://localhost:3308/wizard';
  }

  if (host.includes('eu.posthog.com') || host.includes('eu.i.posthog.com')) {
    return 'https://gateway.eu.posthog.com/wizard';
  }

  return 'https://gateway.us.posthog.com/wizard';
};
