import { IS_DEV } from '../lib/constants';
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

export const getCloudUrlFromRegion = (region: CloudRegion) => {
  if (IS_DEV) {
    return 'http://localhost:8010';
  }

  if (region === 'us') {
    return 'https://us.posthog.com';
  }
  return 'https://eu.posthog.com';
};
