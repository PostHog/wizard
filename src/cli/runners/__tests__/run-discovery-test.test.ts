import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Integration } from '@shared/constants';
import type { DiscoveryTestReport } from '@programs/types';
import {
  discoveryTestFiles,
  discoveryTestFormat,
  formatDiscoveryTest,
  saveDiscoveryReport,
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
  projectSelection: {
    repoType: 'monorepo',
    isDiscoveryComplete: true,
    selectedProjectPath: 'apps/web',
    asks: true,
    projects: [
      {
        path: 'apps/web',
        frameworkName: 'Next.js',
        eligible: true,
        isMainApp: true,
      },
      {
        path: 'packages/ui',
        eligible: false,
        exclusionReason: 'library',
        isMainApp: false,
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
      projectSelection: {
        ...report.projectSelection,
        selectedProjectPath: `apps/${escape}web`,
        projects: [
          { ...report.projectSelection.projects[0], path: `apps/${escape}web` },
        ],
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
    expect(text).toMatch(/packages\/ui\s+not eligible: library/);
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

  it('says the project selection is unused while the flag is off', () => {
    expect(formatDiscoveryTest({ ...report, mode: 'off' })).toContain(
      'not used while the flag is off',
    );
  });
});

describe('saving the report', () => {
  let base: string;
  let repo: string;

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'report-')));
    repo = path.join(base, 'repo');
    fs.mkdirSync(repo);
  });
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

  it('saves to a plain path, making the folders on the way', () => {
    const file = path.join(repo, 'scratch', 'discovery.txt');
    saveDiscoveryReport(file, 'first\n', [repo]);
    saveDiscoveryReport(file, 'second\n', [repo]);
    expect(fs.readFileSync(file, 'utf8')).toBe('second\n');
  });

  it('refuses a link at the file, and leaves what it points to alone', () => {
    const startup = path.join(base, 'startup-file');
    fs.writeFileSync(startup, 'mine\n');
    fs.mkdirSync(path.join(repo, 'scratch'));
    const file = path.join(repo, 'scratch', 'discovery.txt');
    fs.symlinkSync(startup, file);

    expect(() => saveDiscoveryReport(file, 'report\n', [repo])).toThrow(
      /is a link or not a plain file/,
    );
    // The last part is refused wherever the file is, not only below a boundary.
    expect(() => saveDiscoveryReport(file, 'report\n', [])).toThrow(
      /is a link or not a plain file/,
    );
    expect(fs.readFileSync(startup, 'utf8')).toBe('mine\n');
  });

  it('refuses a linked folder on the way, below a boundary only', () => {
    const elsewhere = path.join(base, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, path.join(repo, 'scratch'));
    const file = path.join(repo, 'scratch', 'out', 'discovery.txt');

    expect(() => saveDiscoveryReport(file, 'report\n', [repo])).toThrow(
      /is a link or not a folder/,
    );
    expect(fs.readdirSync(elsewhere)).toEqual([]);

    // A link above the boundary is the machine's own, such as /tmp on macOS.
    const alias = path.join(base, 'alias');
    fs.symlinkSync(repo, alias);
    const plain = path.join(alias, 'discovery.txt');
    saveDiscoveryReport(plain, 'report\n', [path.join(alias, 'apps')]);
    expect(fs.readFileSync(path.join(repo, 'discovery.txt'), 'utf8')).toBe(
      'report\n',
    );
  });
});
