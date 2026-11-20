import { describe, expect, it } from 'vitest';
import { Integration } from '@shared/constants';
import type { DiscoveryTestReport } from '@programs/types';
import { formatDiscoveryTest, wantsDiscoveryTest } from '../run-discovery-test';

const report: DiscoveryTestReport = {
  program: 'posthog-integration',
  mode: 'one-project',
  runDir: '/repo/apps/web',
  rootDir: '/repo',
  runProject: 'apps/web',
  repoType: 'monorepo',
  workspaceTool: 'pnpm',
  walk: { files: 9, complete: true, truncated: false },
  detection: {
    integration: 'nextjs',
    label: null,
    posthogSdkDetected: false,
    discoveredFeatures: [],
  },
  projects: [
    {
      path: 'apps/web',
      isRunProject: true,
      traits: { framework: Integration.nextjs, posthogInstalled: 'no' },
      unsettled: ['framework'],
      sources: {
        framework: [
          { value: Integration.nextjs, source: 'static' },
          { value: Integration.vue, source: 'decisions', confidence: 0.7 },
        ],
        posthogInstalled: [{ value: 'no', source: 'static' }],
      },
      tools: ['Stripe'],
    },
  ],
  toolsMatched: true,
  plan: {
    repoType: 'monorepo',
    complete: true,
    picked: 'apps/web',
    asks: true,
    projects: [
      {
        path: 'apps/web',
        frameworkName: 'Next.js',
        offered: true,
        mainApp: true,
      },
      {
        path: 'packages/ui',
        offered: false,
        reason: 'library',
        mainApp: false,
      },
    ],
  },
  matchKeys: { framework: ['nextjs'] },
};

describe('test discovery mode', () => {
  it('is asked for by the flag alone or with a format', () => {
    expect(wantsDiscoveryTest({})).toBe(false);
    expect(wantsDiscoveryTest({ testDiscovery: '' })).toBe(true);
    expect(wantsDiscoveryTest({ testDiscovery: 'json' })).toBe(true);
  });

  it('prints each trait with the value a run uses and what every source said', () => {
    const text = formatDiscoveryTest(report);
    expect(text).toContain('wizard-project-discovery = one-project');
    expect(text).toContain('apps/web  <- run project');
    expect(text).toMatch(
      /framework\s+nextjs\s+static=nextjs {2}decisions=vue@0\.70 {2}\(unsettled\)/,
    );
    expect(text).toMatch(/tools\s+Stripe/);
    expect(text).toContain('asks after login, picks apps/web');
    expect(text).toMatch(/packages\/ui\s+not offered: library/);
  });

  it('says the plan is unused while the flag is off', () => {
    expect(formatDiscoveryTest({ ...report, mode: 'off' })).toContain(
      'not used while the flag is off',
    );
  });
});
