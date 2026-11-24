import { describe, expect, it } from 'vitest';
import { Integration } from '@shared/constants';
import type { DiscoveryTestReport } from '@programs/types';
import {
  discoveryTestFiles,
  discoveryTestFormat,
  formatDiscoveryTest,
  wantsDiscoveryTest,
} from '../run-discovery-test';

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
  decisions: {
    asked: false,
    reason: 'no gateway token; set WIZARD_CI_GATEWAY_TOKEN_FILE to ask',
  },
};

describe('test discovery mode', () => {
  it('prints no control character a file name in the repo holds', () => {
    const escape = '\u001b[2J\u001b]0;owned\u0007';
    const text = formatDiscoveryTest({
      ...report,
      runDir: `/work/${escape}repo/apps/web`,
      rootDir: `/work/${escape}repo`,
      runProject: `apps/${escape}web`,
      projects: [
        {
          ...report.projects[0],
          path: `apps/${escape}web`,
          traits: { mcpServers: [`src/${escape}server.ts`] },
          sources: {
            mcpServers: [
              { value: [`src/${escape}server.ts`], source: 'static' },
            ],
          },
          unsettled: [],
        },
      ],
      plan: {
        ...report.plan,
        picked: `apps/${escape}web`,
        projects: [{ ...report.plan.projects[0], path: `apps/${escape}web` }],
      },
    });
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/[\u0000-\u0009\u000B-\u001F\u007F]/);
    expect(text).toContain('src/?[2J?]0;owned?server.ts');
  });

  it('is asked for by the flag alone or with a format', () => {
    expect(wantsDiscoveryTest({})).toBe(false);
    expect(wantsDiscoveryTest({ testDiscovery: '' })).toBe(true);
    expect(wantsDiscoveryTest({ testDiscovery: 'json' })).toBe(true);
  });

  it('saves JSON when the mode or the file name asks for it, and text otherwise', () => {
    expect(discoveryTestFormat('')).toBe('text');
    expect(discoveryTestFormat('json')).toBe('json');
    expect(discoveryTestFormat('', 'a/b.JSON')).toBe('json');
    expect(discoveryTestFormat('', 'a/b.txt')).toBe('text');
  });

  it('saves to every file the option names', () => {
    expect(discoveryTestFiles({})).toEqual([]);
    expect(discoveryTestFiles({ testDiscoveryOut: 'a.txt' })).toEqual([
      'a.txt',
    ]);
    expect(
      discoveryTestFiles({ testDiscoveryOut: ['a.txt', 'a.json'] }),
    ).toEqual(['a.txt', 'a.json']);
  });

  it('prints each trait with the value a run uses and what every source said', () => {
    const text = formatDiscoveryTest(report);
    expect(text).toContain('wizard-project-discovery = one-project');
    expect(text).toContain('apps/web  <- run project');
    expect(text).toMatch(/Trait\s+Value\s+Source/);
    expect(text).toMatch(
      /framework\s+nextjs\s+static {2}\[decisions said vue, 0\.70\] {2}\(unsettled\)/,
    );
    expect(text).toMatch(/posthogInstalled\s+no\s+static\n/);
    expect(text).toMatch(/tools\s+Stripe/);
    expect(text).toContain('asks after login, picks apps/web');
    expect(text).toMatch(/packages\/ui\s+not offered: library/);
  });

  it('names every source that gave the value a run uses, with its confidence', () => {
    const text = formatDiscoveryTest({
      ...report,
      projects: [
        {
          ...report.projects[0],
          traits: { webFrontend: 'yes' },
          unsettled: [],
          sources: {
            webFrontend: [
              { value: 'yes', source: 'static' },
              { value: 'yes', source: 'decisions', confidence: 0.91 },
            ],
          },
        },
      ],
    });
    expect(text).toMatch(/webFrontend\s+yes\s+static, decisions 0\.91\n/);
  });

  it('says which sources ran, and why Decisions was not asked', () => {
    const text = formatDiscoveryTest(report);
    expect(text).toMatch(/Sources\s+static only\n/);
    expect(text).toMatch(/Decisions\s+not asked: no gateway token/);
    expect(text).toMatch(/Agentic\s+not run/);
    expect(text).not.toContain('Decisions answers');
  });

  it('prints what a Decisions call answered', () => {
    const text = formatDiscoveryTest({
      ...report,
      decisions: {
        asked: true,
        use: 'traits',
        model: 'gpt-6-luna',
        answered: 2,
        total: 3,
        durationMs: 640,
        inputTokens: 219,
        answers: { calls_llm_api: 0.91, framework: 'nextjs@0.88' },
      },
    });
    expect(text).toMatch(/Sources\s+static and decisions\n/);
    expect(text).toMatch(
      /Decisions\s+gpt-6-luna, written as traits: 2 of 3 answered in 640 ms, 219 input tokens/,
    );
    expect(text).toMatch(/calls_llm_api\s+0\.91/);
    expect(text).toMatch(/framework\s+nextjs@0\.88/);
  });

  it('says the plan is unused while the flag is off', () => {
    expect(formatDiscoveryTest({ ...report, mode: 'off' })).toContain(
      'not used while the flag is off',
    );
  });
});
