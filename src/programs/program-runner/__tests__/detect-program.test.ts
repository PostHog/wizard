import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('@services/codebase-scan', () => ({
  scanCodebaseFor: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    captureException: vi.fn(),
  },
}));
vi.mock('@utils/debug', () => ({
  logToFile: vi.fn(),
}));

import { buildSession, SessionStore } from '@services/session';
import {
  detectPostHogIntegration,
  POSTHOG_SDKS_KEY,
} from '@services/detection';
import type {
  CiRunnerContext,
  ProgramConfig,
} from '@programs/program-contract';
import { detectProgram, detectionFailure } from '../detect-program';

const baseConfig = (overrides: Partial<ProgramConfig> = {}): ProgramConfig =>
  ({
    id: 'posthog-integration',
    description: 'Integrate PostHog',
    sdkSupport: true,
    run: {
      integrationLabel: 'python',
      spinnerMessage: 'Integrating',
      successMessage: 'Done',
      estimatedDurationMinutes: 5,
      reportFile: 'posthog-report.md',
      docsUrl: 'https://posthog.com/docs/libraries/python',
    },
    ...overrides,
  } as unknown as ProgramConfig);

const runner: CiRunnerContext = {
  log: { info: vi.fn(), warn: vi.fn() },
  authenticate: vi.fn().mockResolvedValue(undefined),
  onProgress: vi.fn(),
};

describe('detectProgram and detectionFailure', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-prog-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records detected PostHog SDKs and re-scans if ciPreRun changes installDir', async () => {
    const subDir = path.join(tmpDir, 'backend');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(
      path.join(subDir, 'requirements.txt'),
      'posthog>=7.40.0,<8\n',
    );

    const store = new SessionStore(
      buildSession({ installDir: tmpDir, ci: true }),
    );
    await detectProgram(
      baseConfig({
        ciPreRun: (draft) => {
          draft.installDir = subDir;
          return Promise.resolve();
        },
      }),
      store,
      runner,
    );

    expect(store.session.detectionComplete).toBe(true);
    expect(store.session.frameworkContext[POSTHOG_SDKS_KEY]).toMatchObject([
      {
        key: 'posthog-python',
        major: 7,
        constraintKind: 'range',
      },
    ]);
    expect(detectionFailure(baseConfig(), store.session)).toBeNull();
  });

  it.each([
    ['Python 6', 'requirements.txt', 'posthog==6.0.0\n'],
    [
      'Node 4',
      'package.json',
      JSON.stringify({ dependencies: { 'posthog-node': '^4.18.0' } }),
    ],
  ])(
    'records an old %s SDK major without blocking the run',
    async (_label, filename, contents) => {
      fs.writeFileSync(path.join(tmpDir, filename), contents);
      const store = new SessionStore(buildSession({ installDir: tmpDir }));
      await detectProgram(baseConfig(), store, runner);

      expect(store.session.frameworkContext[POSTHOG_SDKS_KEY]).toHaveLength(1);
      expect(detectionFailure(baseConfig(), store.session)).toBeNull();
    },
  );

  it('skips the SDK scan when sdkSupport is not enabled', async () => {
    fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'posthog==6.0.0\n');
    const store = new SessionStore(buildSession({ installDir: tmpDir }));
    const nonSdkConfig = baseConfig({ id: 'migration', sdkSupport: false });

    await detectProgram(nonSdkConfig, store, runner);

    expect(store.session.frameworkContext[POSTHOG_SDKS_KEY]).toBeUndefined();
    expect(detectionFailure(nonSdkConfig, store.session)).toBeNull();
  });

  it('skips redundant SDK rescan when hooks already recorded SDKs for the same installDir', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { 'posthog-node': '^5.0.0' } }),
    );
    const store = new SessionStore(buildSession({ installDir: tmpDir }));

    await detectProgram(
      baseConfig({
        onReady: async (ctx) => {
          await detectPostHogIntegration(ctx);
          fs.writeFileSync(
            path.join(tmpDir, 'requirements.txt'),
            'posthog>=7.40.0,<8\n',
          );
        },
      }),
      store,
      runner,
    );

    expect(store.session.frameworkContext[POSTHOG_SDKS_KEY]).toMatchObject([
      { key: 'posthog-node', major: 5 },
    ]);
  });

  it('resolves a ciPreRun-scoped dir against the launch root lockfile', async () => {
    const api = path.join(tmpDir, 'apps', 'api');
    fs.mkdirSync(api, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'pnpm-lock.yaml'),
      [
        'packages:',
        "  'posthog-node@5.12.0(typescript@5.0.0)':",
        '    resolution: {integrity: sha512-ph}',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(api, 'package.json'),
      JSON.stringify({
        dependencies: { 'posthog-node': '^4.18.0 || ^5.0.0' },
      }),
    );
    const store = new SessionStore(
      buildSession({ installDir: tmpDir, ci: true }),
    );
    const config = baseConfig({
      ciPreRun: (draft: { installDir: string }) => {
        draft.installDir = api;
        return Promise.resolve();
      },
    } as never);

    await detectProgram(config, store, runner);

    expect(store.session.frameworkContext[POSTHOG_SDKS_KEY]).toEqual([
      expect.objectContaining({ major: 5, resolvedVersion: '5.12.0' }),
    ]);
  });
});
