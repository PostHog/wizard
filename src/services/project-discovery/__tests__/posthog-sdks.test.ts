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
      'PostHog@3',
      'com.posthog:posthog-android@3',
      'github.com/posthog/posthog-go@1',
      'github.com/posthog/posthog-ios@3',
      'posthog-node@4',
      'posthog-rs@0',
      'posthog@7',
      'posthog_flutter@4',
    ]);
  });

  it('reports each product the declared SDK is below the minimum for', async () => {
    const gaps = sdkFeatureGaps(await nodeProject('^4.3.0'), [
      'errorTracking',
      'mcpAnalytics',
    ]);
    expect(gaps.map((g) => [g.feature, g.version, g.minimum])).toEqual([
      ['errorTracking', '4.3.0', '4.5.0'],
      ['mcpAnalytics', '4.3.0', '5.0.0'],
    ]);
  });

  it('passes a product once the declared SDK reaches its minimum', async () => {
    expect(
      sdkFeatureGaps(await nodeProject('^4.5.0'), ['errorTracking']),
    ).toEqual([]);
  });

  it('changes nothing while versioned SDK skills are off', async () => {
    const session = await nodeProject('^4.3.0', false);
    expect(getTraits(session).posthogSdks).toBeUndefined();
    expect(sdkFeatureGaps(session, ['errorTracking'])).toEqual([]);
  });
});
