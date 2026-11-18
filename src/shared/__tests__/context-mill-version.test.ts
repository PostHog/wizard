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
    ['1.66.0', 'v1.66.0'],
    ['v1.66.0', 'v1.66.0'],
    [' 1.66.0 ', 'v1.66.0'],
    ['1.67.0-rc.1', 'v1.67.0-rc.1'],
  ])('normalizes %j to the release tag', (raw, tag) => {
    expect(parseContextMillVersion(raw)).toBe(tag);
  });

  it.each([undefined, '', 'latest'])('treats %j as unpinned', (raw) => {
    expect(parseContextMillVersion(raw)).toBeUndefined();
  });

  // The value becomes a URL path, so nothing but a version may pass.
  it.each([
    '1.66',
    'main',
    '../../evil',
    '1.66.0/../latest',
    '1.66.0?x=1',
    'v1.66.0 v1.67.0',
    ['1.66.0', '1.67.0'],
  ])('rejects %j', (raw) => {
    expect(() => parseContextMillVersion(raw)).toThrow(
      /Invalid context-mill version/,
    );
  });
});

describe('the oldest release a pin may name', () => {
  // A prerelease of the oldest release comes before it.
  it.each([
    '1.65.0',
    'v1.59.0',
    '0.99.0',
    '1.65.9-rc.1',
    '1.66.0-rc.1',
    'v1.66.0-beta',
  ])('refuses %j and names the floor', (raw) => {
    expect(() => parseContextMillVersion(raw)).toThrow(/older than 1\.66\.0/);
  });

  it.each(['1.66.0', '1.66.1', '1.66.1-rc.1', '1.100.0', '2.0.0'])(
    'accepts %j',
    (raw) => {
      expect(parseContextMillVersion(raw)).toBe(`v${raw}`);
    },
  );
});

describe('getSkillsBaseUrl with a pinned release', () => {
  afterEach(() => {
    resetContextMillVersion();
    resetLocalDev();
  });

  it('fetches the pinned release, with the AWS mirror as its failover', () => {
    initContextMillVersion('1.66.0');
    const menuUrl = `${getSkillsBaseUrl()}/skill-menu.json`;
    expect(menuUrl).toBe(
      'https://github.com/PostHog/context-mill/releases/download/v1.66.0/skill-menu.json',
    );
    expect(awsUrlFor(menuUrl)).toBe(
      'https://context-mill.posthog.com/v1.66.0/skill-menu.json',
    );
  });

  it('follows the latest release when the pin is `latest`', () => {
    initContextMillVersion('latest');
    expect(getContextMillVersion()).toBeUndefined();
    expect(getSkillsBaseUrl()).toBe(GITHUB_SKILLS_BASE_URL);
  });

  it('keeps a local context-mill ahead of a pin set outside the CLI', () => {
    initLocalDev({ localContextMill: true });
    initContextMillVersion('1.66.0');
    expect(getSkillsBaseUrl()).toBe(LOCAL_SKILLS_BASE_URL);
  });
});
