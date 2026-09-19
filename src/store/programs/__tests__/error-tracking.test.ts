import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ProgramRun } from '../../agent-protocol/program-run.js';
import { Integration } from '../../shared/constants.js';
import type { AgenticDetectionReport } from '../../detection/agentic.js';
import { detectFramework } from '../../detection/index.js';
import { ErrorCodes } from '../../shared/errors/index.js';
import {
  ERROR_TRACKING_PROJECT_PATH_KEY,
  toErrorTrackingReport,
} from '../error-tracking/detect-agentic.js';
import {
  errorTrackingConfig,
  SYMBOL_UPLOAD_CLI_FRAMEWORKS,
} from '../error-tracking/index.js';
import { VARIANTS_REQUIRING_POSTHOG_CLI } from '../error-tracking-upload-source-maps/detect.js';
import { preinstallPostHogCliOnce } from '../shared/posthog-cli-preinstall.js';
import type { WizardSession } from '../../session/wizard-session.js';
import { analytics } from '../../shared/analytics.js';
import { wizardAbort } from '../../shared/wizard-abort.js';

vi.mock('../../detection/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../detection/index.js')>()),
  detectFramework: vi.fn(),
}));
vi.mock('../../detection/project-scope.js', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../detection/project-scope.js')
  >()),
  scopeInstallDirToProject: vi.fn(),
  detectIntegrationProjects: vi.fn(),
}));
vi.mock('../shared/posthog-cli-preinstall.js', () => ({
  preinstallPostHogCliOnce: vi.fn(),
}));
vi.mock('../../shared/wizard-abort.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/wizard-abort.js')>()),
  wizardAbort: vi.fn(),
}));

const resolveRun = errorTrackingConfig.run as (
  session: WizardSession,
) => Promise<ProgramRun>;

const step = (id: string) => errorTrackingConfig.steps.find((s) => s.id === id);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(analytics, 'wizardCapture').mockImplementation(() => undefined);
});

describe('error-tracking program', () => {
  test('runs the error-tracking agent flow', () => {
    expect(errorTrackingConfig.agentFlow).toBe('error-tracking');
  });

  test('declares ci prerequisite work for headless runs', () => {
    expect(errorTrackingConfig.ciPreRun).toBeDefined();
  });

  test('shows the program-specific intro screen', () => {
    expect(step('intro')?.screenId).toBe('error-tracking-intro');
  });

  test('pre-installs no skill — the flow resolves variants per framework', async () => {
    // There is no bare `error-tracking` menu entry; a seeded skillId would
    // send the linear path to a skill-not-found abort and mislead the intro.
    expect(errorTrackingConfig.skillId).toBeUndefined();
    const run = await resolveRun({ integration: null } as WizardSession);
    expect(run.skillId).toBeUndefined();
  });

  test('picks the project after login and before the run', () => {
    const ids = errorTrackingConfig.steps.map((s) => s.id);
    expect(ids.indexOf('auth')).toBeLessThan(ids.indexOf('detect'));
    expect(ids.indexOf('detect')).toBeLessThan(ids.indexOf('run'));
    expect(step('detect')?.screenId).toBe('error-tracking-detect');
  });

  test('runs the agent in the picked project, else the repo root', () => {
    const targetDir = step('run')?.targetDir;
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

    await errorTrackingConfig.ciPreRun?.(session);

    expect(wizardAbort).toHaveBeenCalledWith(
      expect.objectContaining({ code: ErrorCodes.DetectUnsupportedPlatform }),
    );
    expect(session.integration).toBeUndefined();
  });
});

describe('error-tracking run config', () => {
  test('pre-installs posthog-cli when run resolves, after the project pick', async () => {
    await resolveRun({ integration: Integration.swift } as WizardSession);

    expect(preinstallPostHogCliOnce).toHaveBeenCalledWith(
      'error tracking posthog-cli preinstall failed',
      { integration: Integration.swift },
    );
  });

  test('skips the pre-install for platforms without symbol upload', async () => {
    await resolveRun({ integration: Integration.nextjs } as WizardSession);

    expect(preinstallPostHogCliOnce).not.toHaveBeenCalled();
  });
});

describe('error-tracking posthog-cli pre-install set', () => {
  test('contains only real Integration values', () => {
    for (const integration of SYMBOL_UPLOAD_CLI_FRAMEWORKS) {
      expect(Object.values(Integration)).toContain(integration);
    }
  });

  test('matches the source-maps program set, keyed by Integration', () => {
    // Both programs pre-install the CLI for the same platforms. The source-maps
    // program keys them by uploader variant, and only `ios` is spelled
    // differently (`swift` in Integration).
    const expected = [...VARIANTS_REQUIRING_POSTHOG_CLI]
      .map((variant) => (variant === 'ios' ? Integration.swift : variant))
      .sort();
    expect([...SYMBOL_UPLOAD_CLI_FRAMEWORKS].sort()).toEqual(expected);
  });
});
