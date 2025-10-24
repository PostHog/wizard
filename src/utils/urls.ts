import {
  IS_DEV,
  POSTHOG_DEV_CLIENT_ID,
  POSTHOG_EU_CLIENT_ID,
  POSTHOG_US_CLIENT_ID,
} from '../lib/constants';
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

export const getOauthClientIdFromRegion = (region: CloudRegion) => {
  if (IS_DEV) {
    return POSTHOG_DEV_CLIENT_ID;
  }

  if (region === 'us') {
    return POSTHOG_US_CLIENT_ID;
  }
  return POSTHOG_EU_CLIENT_ID;
};
