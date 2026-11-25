import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSession } from '@services/session/wizard-session';
import {
  sdkFeatureGaps,
  VERSIONED_SDK_SKILLS_ENABLED_KEY,
} from '@services/project-discovery';

const createdDirs: string[] = [];

function project(files: Record<string, string>, enabled = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-features-test-'));
  createdDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content, 'utf8');
  }
  const session = buildSession({ installDir: dir });
  session.frameworkContext = { [VERSIONED_SDK_SKILLS_ENABLED_KEY]: enabled };
  return session;
}

const nodeProject = (installed: string, enabled = true) =>
  project(
    {
      'package.json': JSON.stringify({
        dependencies: { 'posthog-node': '^4.0.0' },
      }),
      'node_modules/posthog-node/package.json': JSON.stringify({
        name: 'posthog-node',
        version: installed,
      }),
    },
    enabled,
  );

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('sdkFeatureGaps', () => {
  it('reports each product the installed SDK is below the minimum for', () => {
    const gaps = sdkFeatureGaps(nodeProject('4.3.0'), [
      'errorTracking',
      'mcpAnalytics',
    ]);
    expect(gaps.map((g) => [g.feature, g.version, g.minimum])).toEqual([
      ['errorTracking', '4.3.0', '4.5.0'],
      ['mcpAnalytics', '4.3.0', '5.0.0'],
    ]);
    expect(gaps[0].message).toBe(
      'Error tracking needs posthog-node 4.5.0 or later, and this project has 4.3.0. ' +
        'Upgrade posthog-node to 4.5.0 or later, then run the wizard again.',
    );
  });

  it('passes a product once the installed SDK reaches its minimum', () => {
    expect(sdkFeatureGaps(nodeProject('4.5.0'), ['errorTracking'])).toEqual([]);
  });

  it('reads the lowest version the manifest allows without a lockfile', () => {
    const session = project({ 'requirements.txt': 'posthog>=7.40,<8\n' });
    expect(
      sdkFeatureGaps(session, ['mcpAnalytics']).map((g) => g.version),
    ).toEqual(['7.40.0']);
  });

  it('reports nothing while versioned SDK skills are off', () => {
    expect(
      sdkFeatureGaps(nodeProject('4.3.0', false), ['errorTracking']),
    ).toEqual([]);
  });
});
