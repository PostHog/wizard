import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@utils/analytics', () => ({
  analytics: {
    captureException: vi.fn(),
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    getAllFlagsForWizard: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock(
  import('@services/warehouse-sources/registry'),
  async (importOriginal) =>
    (
      await import(
        '@services/warehouse-sources/__tests__/helpers/tool-catalog.no-jest'
      )
    ).withFixtureCatalog(await importOriginal()),
);

import {
  getTraits,
  runDiscovery,
  sdkFeatureGaps,
  VERSIONED_SDK_SKILLS_ENABLED_KEY,
} from '@services/project-discovery';
import { summarizePosthogSdks } from '@services/project-discovery/traits/sdks';
import { SessionStore } from '@services/session/session-store';
import { buildSession } from '@services/session/wizard-session';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** A project holding `files`, discovered with versioned SDK skills on or off. */
async function discovered(files: Record<string, string>, enabled = true) {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-sdks-')),
  );
  dirs.push(dir);
  for (const [file, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), content);
  }
  const store = new SessionStore(buildSession({ installDir: dir }));
  store.setFrameworkContext(VERSIONED_SDK_SKILLS_ENABLED_KEY, enabled);
  await runDiscovery({ id: 'posthog-integration' }, store.readyContext());
  return store.session;
}

const nodeProject = (range: string, enabled = true) =>
  discovered(
    {
      'package.json': JSON.stringify({
        dependencies: { 'posthog-node': range },
      }),
    },
    enabled,
  );

describe('PostHog SDK versions', () => {
  it('reads the major each SDK manifest declares', async () => {
    const session = await discovered({
      'package.json': JSON.stringify({
        dependencies: { 'posthog-node': '^4.3.0' },
      }),
      'requirements.txt': 'posthog[sentry]>=7.40,<8\n',
      'go.mod': 'module app\n\nrequire github.com/posthog/posthog-go v1.5.0\n',
      'Cargo.toml': '[dependencies]\nposthog-rs = { version = "0.3" }\n',
      'pubspec.yaml': 'dependencies:\n  posthog_flutter: ^4.0.0\n',
      'build.gradle.kts':
        'dependencies {\n  implementation("com.posthog:posthog-android:3.+")\n}\n',
      Podfile: "pod 'PostHog', '~> 3.0'\n",
      'Package.swift':
        '.package(url: "https://github.com/PostHog/posthog-ios.git", from: "3.1.0")',
    });
    expect([...(getTraits(session).posthogSdks ?? [])].sort()).toEqual([
      'cargo:posthog-rs@0',
      'cocoapods:posthog@3',
      'go:github.com/posthog/posthog-go@1',
      'maven:com.posthog:posthog-android@3',
      'npm:posthog-node@4',
      'pub:posthog_flutter@4',
      'pypi:posthog@7',
      'swiftpm:github.com/posthog/posthog-ios@3',
    ]);
  });

  it('distinguishes blocking vs in-range SDK feature gaps and keys minimums by ecosystem', async () => {
    const gaps = sdkFeatureGaps(await nodeProject('^4.3.0'), [
      'errorTracking',
      'mcpAnalytics',
    ]);
    expect(
      gaps.map((g) => [g.feature, g.version, g.minimum, g.blocking]),
    ).toEqual([
      ['errorTracking', '4.3.0', '4.5.0', false],
      ['mcpAnalytics', '4.3.0', '5.0.0', true],
    ]);

    const rustSession = await discovered({
      'Cargo.toml': '[dependencies]\nposthog = "0.5"\n',
    });
    expect(getTraits(rustSession).posthogSdks).toEqual(['cargo:posthog@0']);
    expect(
      sdkFeatureGaps(rustSession, ['mcpAnalytics', 'releaseLinking']).map(
        (g) => [g.feature, g.minimum],
      ),
    ).toEqual([['mcpAnalytics', '0.29.0']]);
  });

  it('passes a product once the declared SDK reaches its minimum', async () => {
    expect(
      sdkFeatureGaps(await nodeProject('^4.5.0'), ['errorTracking']),
    ).toEqual([]);
  });

  it('catches PEP 440 prerelease pins below a product minimum', async () => {
    const session = await discovered({
      'requirements.txt': 'posthog==7.40.0rc1\n',
    });
    expect(
      sdkFeatureGaps(session, ['mcpAnalytics']).map((g) => g.feature),
    ).toEqual(['mcpAnalytics']);
  });

  it('changes nothing while versioned SDK skills are off', async () => {
    const session = await nodeProject('^4.3.0', false);
    expect(getTraits(session).posthogSdks).toBeUndefined();
    expect(sdkFeatureGaps(session, ['errorTracking'])).toEqual([]);
  });

  it('summarizes existing SDK presence, minor versions, and pin styles for telemetry', () => {
    expect(summarizePosthogSdks([])).toEqual({
      has_existing_sdk: false,
      detected_sdk_count: 0,
      unversioned_sdk_count: 0,
      detected_sdks: [],
    });
    expect(
      summarizePosthogSdks([
        {
          dir: '.',
          path: 'package.json',
          ecosystem: 'npm',
          packages: ['posthog-node'],
          versions: { 'posthog-node': '^4.3.2' },
        },
      ]),
    ).toEqual({
      has_existing_sdk: true,
      sdk_version_found: 'npm:posthog-node@4.3',
      sdk_version_pin: 'major_range',
      detected_sdk_count: 1,
      unversioned_sdk_count: 0,
      detected_sdks: ['npm:posthog-node'],
    });
    expect(
      summarizePosthogSdks([
        {
          dir: '.',
          path: 'package.json',
          ecosystem: 'npm',
          packages: ['posthog-node'],
          versions: { 'posthog-node': '4.3.0' },
        },
        {
          dir: '.',
          path: 'requirements.txt',
          ecosystem: 'pypi',
          packages: ['posthog'],
          versions: { posthog: '>=6' },
        },
        {
          dir: '.',
          path: 'Gemfile',
          ecosystem: 'rubygems',
          packages: ['posthog-ruby'],
          versions: {},
        },
      ]),
    ).toEqual({
      has_existing_sdk: true,
      sdk_version_found: 'npm:posthog-node@4.3,pypi:posthog@6.0',
      sdk_version_pin: 'mixed',
      detected_sdk_count: 3,
      unversioned_sdk_count: 1,
      detected_sdks: [
        'npm:posthog-node',
        'pypi:posthog',
        'rubygems:posthog-ruby',
      ],
    });
    expect(
      summarizePosthogSdks([
        {
          dir: '.',
          path: 'requirements.txt',
          ecosystem: 'pypi',
          packages: ['posthog'],
          versions: { posthog: '==7.40.0' },
        },
      ]),
    ).toMatchObject({
      sdk_version_found: 'pypi:posthog@7.40',
      sdk_version_pin: 'exact',
    });
    expect(
      summarizePosthogSdks([
        {
          dir: '.',
          path: 'requirements.txt',
          ecosystem: 'pypi',
          packages: ['posthog'],
          versions: { posthog: '>=6' },
        },
      ]),
    ).toMatchObject({
      sdk_version_found: 'pypi:posthog@6.0',
      sdk_version_pin: 'wide_range',
    });
    expect(
      summarizePosthogSdks([
        {
          dir: '.',
          path: 'package.json',
          ecosystem: 'npm',
          packages: ['posthog-node'],
          versions: { 'posthog-node': 'workspace:*' },
        },
      ]),
    ).toEqual({
      has_existing_sdk: true,
      sdk_version_pin: 'none',
      detected_sdk_count: 1,
      unversioned_sdk_count: 1,
      detected_sdks: ['npm:posthog-node'],
    });
    expect(
      summarizePosthogSdks([
        {
          dir: '.',
          path: 'Cargo.toml',
          ecosystem: 'cargo',
          packages: ['posthog-rs'],
          versions: { 'posthog-rs': '0.3.5' },
        },
      ]),
    ).toMatchObject({
      sdk_version_found: 'cargo:posthog-rs@0.3',
      sdk_version_pin: 'major_range',
    });
    expect(
      summarizePosthogSdks([
        {
          dir: '.',
          path: 'Cargo.toml',
          ecosystem: 'cargo',
          packages: ['posthog-rs'],
          versions: { 'posthog-rs': '=0.3.5' },
        },
      ]),
    ).toMatchObject({
      sdk_version_found: 'cargo:posthog-rs@0.3',
      sdk_version_pin: 'exact',
    });
    expect(
      summarizePosthogSdks([
        {
          dir: '.',
          path: 'package.json',
          ecosystem: 'npm',
          packages: ['posthog-node'],
          versions: { 'posthog-node': `>=${Number.MAX_SAFE_INTEGER}.0.0` },
        },
      ]),
    ).toEqual({
      has_existing_sdk: true,
      sdk_version_pin: 'none',
      detected_sdk_count: 1,
      unversioned_sdk_count: 1,
      detected_sdks: ['npm:posthog-node'],
    });
  });
});
