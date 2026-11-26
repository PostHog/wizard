import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@services/detection/decisions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@services/detection/decisions')>()),
  runDecisionsSource: vi.fn(),
}));

import { WIZARD_PROJECT_DISCOVERY_FLAG_KEY } from '@shared/constants';
import { runDecisionsSource } from '@services/detection/decisions';
import { analytics } from '@utils/analytics';
import type { ProgramConfig } from '@programs/program-contract';
import { testDiscovery } from '../discovery-test';

let repo: string;

const write = (file: string, content: string): void => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), content);
};

const program = (overrides: Partial<ProgramConfig> = {}): ProgramConfig =>
  ({ id: 'metrics', ...overrides } as ProgramConfig);

beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'preview-')));
  fs.mkdirSync(path.join(repo, '.git'));
  write('package.json', '{}');
  write('pnpm-workspace.yaml', 'packages:\n  - apps/*\n');
  write('apps/web/package.json', '{"dependencies":{"next":"15.0.0"}}');
  write('apps/admin/package.json', '{"dependencies":{"vue":"^3.4.0"}}');
  vi.mocked(analytics.getAllFlagsForWizard).mockResolvedValue({
    [WIZARD_PROJECT_DISCOVERY_FLAG_KEY]: 'one-project',
  });
});

afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('the project selection a test discovery previews', () => {
  it('asks for a program that picks its project, as the run would', async () => {
    const report = await testDiscovery(program({ appliesTo: () => true }), {
      installDir: repo,
    });
    expect(report.mode).toBe('one-project');
    expect(report.projectSelection.asks).toBe(true);
  });

  it('asks nothing for a program that picks no project, and stays where the run started', async () => {
    const report = await testDiscovery(program(), { installDir: repo });
    expect(report.projectSelection.asks).toBe(false);
    expect(report.projectSelection.selectedProjectPath).toBe('.');
  });

  it('previews the project a caller names, and asks nothing', async () => {
    const report = await testDiscovery(
      program({ appliesTo: () => true }),
      { installDir: repo },
      'apps/admin',
    );
    expect(report.runProject).toBe('apps/admin');
    expect(report.projectSelection.selectedProjectPath).toBe('apps/admin');
    expect(report.projectSelection.asks).toBe(false);
  });

  it('detects in the project a run moves up to, not the folder it started in', async () => {
    fs.mkdirSync(path.join(repo, 'apps/web/src'));
    const detectedIn: string[] = [];
    const report = await testDiscovery(
      program({
        onReady: (ctx) => {
          detectedIn.push(ctx.session.installDir);
          return Promise.resolve();
        },
      }),
      { installDir: path.join(repo, 'apps/web/src') },
    );
    expect(report.runProject).toBe('apps/web');
    expect(detectedIn).toEqual([path.join(repo, 'apps/web')]);
  });

  it('asks nothing in a CI run or with the flag off', async () => {
    const picks = program({ appliesTo: () => true });
    const ci = await testDiscovery(picks, { installDir: repo, ci: true });
    expect(ci.projectSelection.asks).toBe(false);

    vi.mocked(analytics.getAllFlagsForWizard).mockResolvedValue({});
    const off = await testDiscovery(picks, { installDir: repo });
    expect(off.mode).toBe('off');
    expect(off.projectSelection.asks).toBe(false);
    expect(off.projectSelection.selectedProjectPath).toBe('.');
  });
});

describe('the Decisions call a test discovery makes', () => {
  const gateway = {
    token: 'phs_test',
    url: 'https://ai-gateway.us.posthog.com',
  };
  const ranks = program({
    rankWith: ['decisions'],
    decisions: ['web_frontend'],
  });
  const bothFlags = (decisions: string) =>
    vi.mocked(analytics.getAllFlagsForWizard).mockResolvedValue({
      [WIZARD_PROJECT_DISCOVERY_FLAG_KEY]: 'one-project',
      'wizard-decisions-detection': decisions,
    });

  beforeEach(() => vi.mocked(runDecisionsSource).mockReset());

  it('asks nothing without a gateway token, with the flag off, or for a program that does not rank with it', async () => {
    bothFlags('traits');
    const none = await testDiscovery(ranks, { installDir: repo });
    expect(none.decisions).toMatchObject({ asked: false });

    const other = await testDiscovery(
      program(),
      { installDir: repo },
      undefined,
      gateway,
    );
    expect(other.decisions).toMatchObject({ asked: false });

    bothFlags('false');
    const off = await testDiscovery(
      ranks,
      { installDir: repo },
      undefined,
      gateway,
    );
    expect(off.decisions).toEqual({
      asked: false,
      reason: 'wizard-decisions-detection is off',
    });
    expect(runDecisionsSource).not.toHaveBeenCalled();
  });

  it('asks through the gateway token, with no login, and reports the answers', async () => {
    bothFlags('traits');
    vi.mocked(runDecisionsSource).mockResolvedValue({
      mode: 'shadow',
      answers: { web_frontend: { kind: 'predicate', probability: 0.91 } },
      unanswered: ['calls_llm_api'],
      model: 'gpt-6-luna',
      durationMs: 640,
      inputTokens: 219,
      redactedLines: 0,
    });

    const report = await testDiscovery(
      ranks,
      { installDir: repo },
      undefined,
      gateway,
    );

    expect(report.decisions).toEqual({
      asked: true,
      use: 'traits',
      model: 'gpt-6-luna',
      answered: 1,
      total: 2,
      durationMs: 640,
      inputTokens: 219,
      answers: { web_frontend: 0.91 },
    });
    const asked = vi.mocked(runDecisionsSource).mock.calls[0][1];
    // The token is all the call has: no access token, and a sink because the flag says traits.
    expect(asked.session.credentials).toMatchObject({
      accessToken: '',
      gateway,
    });
    expect(asked.sink).toBeDefined();
  });

  it('only compares when the flag says compare', async () => {
    bothFlags('compare');
    vi.mocked(runDecisionsSource).mockResolvedValue({
      mode: 'shadow',
      answers: {},
      unanswered: ['web_frontend'],
      model: 'gpt-6-luna',
      durationMs: 5,
      inputTokens: 0,
      redactedLines: 0,
      error: 'gateway refused',
    });

    const report = await testDiscovery(
      ranks,
      { installDir: repo },
      undefined,
      gateway,
    );

    expect(report.decisions).toMatchObject({
      asked: true,
      use: 'compare',
      answered: 0,
      error: 'gateway refused',
    });
    expect(vi.mocked(runDecisionsSource).mock.calls[0][1].sink).toBeUndefined();
  });
});
