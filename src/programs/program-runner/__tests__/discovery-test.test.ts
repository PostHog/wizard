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

import { WIZARD_PROJECT_DISCOVERY_FLAG_KEY } from '@shared/constants';
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

describe('the plan a test discovery previews', () => {
  it('asks for a program that picks its project, as the run would', async () => {
    const report = await testDiscovery(program({ appliesTo: () => true }), {
      installDir: repo,
    });
    expect(report.mode).toBe('one-project');
    expect(report.plan.asks).toBe(true);
  });

  it('asks nothing for a program that picks no project, and stays where the run started', async () => {
    const report = await testDiscovery(program(), { installDir: repo });
    expect(report.plan.asks).toBe(false);
    expect(report.plan.picked).toBe('.');
  });

  it('previews the project a caller names, and asks nothing', async () => {
    const report = await testDiscovery(
      program({ appliesTo: () => true }),
      { installDir: repo },
      'apps/admin',
    );
    expect(report.runProject).toBe('apps/admin');
    expect(report.plan.picked).toBe('apps/admin');
    expect(report.plan.asks).toBe(false);
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
    expect(ci.plan.asks).toBe(false);

    vi.mocked(analytics.getAllFlagsForWizard).mockResolvedValue({});
    const off = await testDiscovery(picks, { installDir: repo });
    expect(off.mode).toBe('off');
    expect(off.plan.asks).toBe(false);
    expect(off.plan.picked).toBe('.');
  });
});
