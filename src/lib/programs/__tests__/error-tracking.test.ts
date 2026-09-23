import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ProgramRun } from '@lib/programs/program-run';
import { Integration } from '@shared/constants';
import type { AgenticDetectionReport } from '@lib/detection/agentic';
import { detectFramework } from '@lib/detection/index';
import { ErrorCodes } from '@shared/errors';
import { ERROR_TRACKING_TIPS } from '@lib/programs/error-tracking/content/tips';
import {
  ERROR_TRACKING_PROJECT_PATH_KEY,
  toErrorTrackingReport,
} from '@lib/programs/error-tracking/detect-agentic';
import {
  errorTrackingConfig,
  SYMBOL_UPLOAD_CLI_FRAMEWORKS,
} from '@lib/programs/error-tracking/index';
import { VARIANTS_REQUIRING_POSTHOG_CLI } from '@lib/programs/error-tracking-upload-source-maps/detect';
import { preinstallPostHogCliOnce } from '@lib/programs/shared/posthog-cli-preinstall';
import type { WizardSession } from '@lib/wizard-session';
import { analytics } from '@utils/analytics';
import { wizardAbort } from '@utils/wizard-abort';

vi.mock('@lib/detection/index', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lib/detection/index')>()),
  detectFramework: vi.fn(),
}));
vi.mock('@lib/detection/project-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lib/detection/project-scope')>()),
  scopeInstallDirToProject: vi.fn(),
  detectIntegrationProjects: vi.fn(),
}));
vi.mock('@lib/programs/shared/posthog-cli-preinstall', () => ({
  preinstallPostHogCliOnce: vi.fn(),
}));
vi.mock('@utils/wizard-abort', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@utils/wizard-abort')>()),
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

describe('error-tracking tips', () => {
  const replayTip = ERROR_TRACKING_TIPS.find((t) => t.id === 'session-replay');
  const storeFor = (integration: Integration | null) =>
    ({ session: { integration } } as never);

  test('shows the replay tip only where session replay records', () => {
    expect(replayTip?.visible?.(storeFor(Integration.nextjs))).toBe(true);
    expect(replayTip?.visible?.(storeFor(Integration.javascriptNode))).toBe(
      false,
    );
    expect(replayTip?.visible?.(storeFor(null))).toBe(false);
  });
});
