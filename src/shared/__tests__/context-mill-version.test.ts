import { describe, it, expect, afterEach } from 'vitest';

import {
  getContextMillVersion,
  initContextMillVersion,
  parseContextMillVersion,
  resetContextMillVersion,
} from '@shared/context-mill-version';
import {
  getSkillsBaseUrl,
  GITHUB_SKILLS_BASE_URL,
  LOCAL_SKILLS_BASE_URL,
} from '@shared/constants';
import { awsUrlFor } from '@shared/fetch-retry';
import { initLocalDev, resetLocalDev } from '@shared/local-dev';

describe('parseContextMillVersion', () => {
  it.each([
    ['1.59.0', 'v1.59.0'],
    ['v1.59.0', 'v1.59.0'],
    [' 1.59.0 ', 'v1.59.0'],
    ['1.60.0-rc.1', 'v1.60.0-rc.1'],
  ])('normalizes %j to the release tag', (raw, tag) => {
    expect(parseContextMillVersion(raw)).toBe(tag);
  });

  it.each([undefined, '', 'latest'])('treats %j as unpinned', (raw) => {
    expect(parseContextMillVersion(raw)).toBeUndefined();
  });

  // The value becomes a URL path, so nothing but a version may pass.
  it.each([
    '1.59',
    'main',
    '../../evil',
    '1.59.0/../latest',
    '1.59.0?x=1',
    'v1.59.0 v1.60.0',
    ['1.59.0', '1.60.0'],
  ])('rejects %j', (raw) => {
    expect(() => parseContextMillVersion(raw)).toThrow(
      /Invalid context-mill version/,
    );
  });
});

describe('getSkillsBaseUrl with a pinned release', () => {
  afterEach(() => {
    resetContextMillVersion();
    resetLocalDev();
  });

  it('fetches the pinned release, with the AWS mirror as its failover', () => {
    initContextMillVersion('1.59.0');
    const menuUrl = `${getSkillsBaseUrl()}/agent-menu.json`;
    expect(menuUrl).toBe(
      'https://github.com/PostHog/context-mill/releases/download/v1.59.0/agent-menu.json',
    );
    expect(awsUrlFor(menuUrl)).toBe(
      'https://context-mill.posthog.com/v1.59.0/agent-menu.json',
    );
  });

  it('follows the latest release when the pin is `latest`', () => {
    initContextMillVersion('latest');
    expect(getContextMillVersion()).toBeUndefined();
    expect(getSkillsBaseUrl()).toBe(GITHUB_SKILLS_BASE_URL);
  });

  it('keeps a local context-mill ahead of a pin set outside the CLI', () => {
    initLocalDev({ localContextMill: true });
    initContextMillVersion('1.59.0');
    expect(getSkillsBaseUrl()).toBe(LOCAL_SKILLS_BASE_URL);
  });
});
