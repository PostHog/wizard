import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ProgramRun } from '@programs/program-run';
import { Integration } from '@shared/constants';
import type { AgenticDetectionReport } from '@programs/detection/agentic';
import { detectFramework } from '@programs/detection/framework';
import { ErrorCodes } from '@shared/errors';
import {
  ERROR_TRACKING_PROJECT_PATH_KEY,
  toErrorTrackingReport,
} from '@programs/error-tracking/detect-agentic';
import { config as errorTracking } from '@programs/error-tracking';
import { preinstallPostHogCliOnce } from '@programs/shared/posthog-cli-preinstall';
import type { CiRunnerContext, RunnerContext } from '@programs/runner-context';
import type { WizardSession } from '@programs/session/wizard-session';
import { scopeInstallDirToProject } from '@programs/detection/project-scope';
import { analytics } from '@utils/analytics';
import { ProgramAbort } from '@programs/program-abort';

vi.mock(import('@programs/detection/framework'), async (importOriginal) => ({
  ...(await importOriginal()),
  detectFramework: vi.fn(),
}));
vi.mock(
  import('@programs/detection/project-scope'),
  async (importOriginal) => ({
    ...(await importOriginal()),
    scopeInstallDirToProject: vi.fn(),
    detectIntegrationProjects: vi.fn(),
  }),
);
vi.mock(import('@programs/shared/posthog-cli-preinstall'), () => ({
  preinstallPostHogCliOnce: vi.fn(),
}));

/** The runner's log in a run with no host to show it. */
const log: RunnerContext['log'] = {
  info: () => undefined,
  warn: () => undefined,
};
/** A headless runner that is already logged in. */
const ciRunner = (): CiRunnerContext => ({
  log,
  authenticate: () => Promise.resolve(),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(analytics, 'wizardCapture').mockImplementation(() => undefined);
});

describe('error-tracking program', () => {
  test('pre-installs no skill — the flow resolves variants per framework', () => {
    // There is no bare `error-tracking` menu entry; a seeded skillId would
    // send the linear path to a skill-not-found abort and mislead the intro.
    expect(errorTracking.skillId).toBeUndefined();
    expect((errorTracking.run as ProgramRun).skillId).toBeUndefined();
  });

  test('runs the agent in the picked project, else the repo root', () => {
    const targetDir = errorTracking.runSteps?.run?.targetDir;
    const picked = {
      installDir: '/repo',
      frameworkContext: { [ERROR_TRACKING_PROJECT_PATH_KEY]: 'apps/web' },
    } as unknown as WizardSession;
    const unpicked = {
      installDir: '/repo',
      frameworkContext: {},
    } as unknown as WizardSession;

    expect(targetDir?.(picked)).toBe('/repo/apps/web');
    expect(targetDir?.(unpicked)).toBe('/repo');
  });
});

describe('error-tracking project picker report', () => {
  const scan = (
    projects: AgenticDetectionReport['projects'],
  ): AgenticDetectionReport => ({ repoType: 'monorepo', projects });

  test('offers supported frameworks with or without PostHog installed', () => {
    const report = toErrorTrackingReport(
      scan([
        {
          path: 'apps/web',
          framework: 'Next.js',
          targetId: 'nextjs',
          hasPostHog: true,
        },
        {
          path: 'apps/api',
          framework: 'Express',
          targetId: 'javascript_node',
          hasPostHog: false,
        },
      ]),
    );

    expect(report.projects.map((p) => p.instrumentable)).toEqual([true, true]);
  });

  test('does not offer KMP or an unknown framework', () => {
    // KMP skill variants have no framework tag, so preflight would abort the run.
    const report = toErrorTrackingReport(
      scan([
        {
          path: 'shared',
          framework: 'KMP',
          targetId: 'kmp',
          hasPostHog: false,
        },
        { path: 'tools', framework: 'Zig', targetId: null, hasPostHog: false },
      ]),
    );

    expect(report.projects.map((p) => p.instrumentable)).toEqual([
      false,
      false,
    ]);
  });

  test('lists the recommended project first', () => {
    const report = toErrorTrackingReport(
      scan([
        {
          path: 'apps/api',
          framework: 'Express',
          targetId: 'javascript_node',
          hasPostHog: false,
        },
        {
          path: 'apps/web',
          framework: 'Next.js',
          targetId: 'nextjs',
          hasPostHog: false,
          recommended: true,
        },
      ]),
    );

    expect(report.projects[0]?.path).toBe('apps/web');
  });
});

describe('error-tracking ciPreRun', () => {
  test('stops KMP before it sets the framework', async () => {
    vi.mocked(detectFramework).mockResolvedValue(Integration.kmp);
    const session = {
      installDir: '/tmp/error-tracking-ci',
      frameworkContext: {},
    } as unknown as WizardSession;

    const runner = ciRunner();
    const stopped = errorTracking.ciPreRun?.(session, runner);

    await expect(stopped).rejects.toBeInstanceOf(ProgramAbort);
    await expect(stopped).rejects.toMatchObject({
      code: ErrorCodes.DetectUnsupportedPlatform,
    });
    expect(scopeInstallDirToProject).toHaveBeenCalledWith(session, runner);
    expect(session.integration).toBeUndefined();
  });
});

describe('error-tracking posthog-cli pre-install', () => {
  test('headless, pre-installs once ciPreRun detects the framework', async () => {
    vi.mocked(detectFramework).mockResolvedValue(Integration.swift);
    const runner = {
      ...ciRunner(),
      log: { info: vi.fn(), warn: vi.fn() },
    };
    const session = {
      installDir: '/tmp/error-tracking-ci',
      frameworkContext: {},
    } as unknown as WizardSession;

    await errorTracking.ciPreRun?.(session, runner);

    expect(preinstallPostHogCliOnce).toHaveBeenCalledWith(
      'error tracking posthog-cli preinstall failed',
      { integration: Integration.swift },
      runner.log,
    );
    const log = vi.mocked(preinstallPostHogCliOnce).mock.calls[0]?.[2];
    log?.warn('install warning');
    expect(runner.log.warn).toHaveBeenCalledWith('install warning');
  });

  test('skips the pre-install for platforms without symbol upload', async () => {
    await errorTracking.runSteps?.run?.onRunPrep?.(
      {
        integration: Integration.nextjs,
        frameworkContext: {},
      } as unknown as WizardSession,
      log,
    );

    expect(preinstallPostHogCliOnce).not.toHaveBeenCalled();
  });
});
