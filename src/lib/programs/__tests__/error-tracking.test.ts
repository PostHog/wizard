import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ProgramRun } from '@lib/agent/runner/shared/types';
import { Integration } from '@lib/constants';
import { detectFramework } from '@lib/detection/index';
import { ErrorCodes } from '@lib/errors';
import {
  errorTrackingConfig,
  SYMBOL_UPLOAD_CLI_FRAMEWORKS,
} from '@lib/programs/error-tracking/index';
import { VARIANTS_REQUIRING_POSTHOG_CLI } from '@lib/programs/error-tracking-upload-source-maps/detect';
import { detectPostHogIntegration } from '@lib/programs/posthog-integration/detect';
import type { ProgramReadyContext } from '@lib/programs/program-step';
import { preinstallPostHogCliOnce } from '@lib/programs/shared/posthog-cli-preinstall';
import type { WizardSession } from '@lib/wizard-session';
import { analytics } from '@utils/analytics';
import { wizardAbort } from '@utils/wizard-abort';

vi.mock('@lib/detection/index', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lib/detection/index')>()),
  detectFramework: vi.fn(),
}));
vi.mock('@lib/detection/project-scope', () => ({
  scopeInstallDirToProject: vi.fn(),
}));
vi.mock('@lib/programs/posthog-integration/detect', () => ({
  detectPostHogIntegration: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(analytics, 'wizardCapture').mockImplementation(() => undefined);
});

describe('error-tracking program', () => {
  test('runs the error-tracking agent flow', () => {
    expect(errorTrackingConfig.agentFlow).toBe('error-tracking');
  });

  test('detects the framework before the agent-skill steps', () => {
    expect(errorTrackingConfig.steps[0]?.id).toBe('detect');
    expect(errorTrackingConfig.steps[0]?.onReady).toBeDefined();
  });

  test('declares ci prerequisite work for headless runs', () => {
    expect(errorTrackingConfig.ciPreRun).toBeDefined();
  });

  test('shows the program-specific intro screen', () => {
    const intro = errorTrackingConfig.steps.find((s) => s.id === 'intro');
    expect(intro?.screenId).toBe('error-tracking-intro');
  });

  test('pre-installs no skill — the flow resolves variants per framework', async () => {
    // There is no bare `error-tracking` menu entry; a seeded skillId would
    // send the linear path to a skill-not-found abort and mislead the intro.
    expect(errorTrackingConfig.skillId).toBeUndefined();
    const run = await resolveRun({ integration: null } as WizardSession);
    expect(run.skillId).toBeUndefined();
  });
});

describe('error-tracking detect step', () => {
  const ctx = {
    session: { installDir: '/tmp/error-tracking-detect' },
  } as unknown as ProgramReadyContext;
  const onReady = errorTrackingConfig.steps[0]!.onReady!;

  test('aborts before the run when no framework is detected', async () => {
    // Without the stop, bootstrap puts the program id on session.skillId and
    // preflight fails with a misleading "failed to download" message.
    vi.mocked(detectFramework).mockResolvedValue(undefined);

    await onReady(ctx);

    expect(wizardAbort).toHaveBeenCalledWith(
      expect.objectContaining({ code: ErrorCodes.DetectNoFramework }),
    );
    expect(detectPostHogIntegration).not.toHaveBeenCalled();
  });

  test('runs the full detection when a framework is found', async () => {
    vi.mocked(detectFramework).mockResolvedValue(Integration.nextjs);

    await onReady(ctx);

    expect(wizardAbort).not.toHaveBeenCalled();
    expect(detectPostHogIntegration).toHaveBeenCalledWith(ctx);
  });

  test('stops KMP, whose skill variants preflight cannot resolve', async () => {
    vi.mocked(detectFramework).mockResolvedValue(Integration.kmp);

    await onReady(ctx);

    expect(wizardAbort).toHaveBeenCalledWith(
      expect.objectContaining({ code: ErrorCodes.DetectUnsupportedPlatform }),
    );
    expect(detectPostHogIntegration).not.toHaveBeenCalled();
  });

  test('installs nothing before the intro gate', async () => {
    // onReady runs before the user can cancel on the intro screen.
    vi.mocked(detectFramework).mockResolvedValue(Integration.swift);

    await onReady(ctx);

    expect(preinstallPostHogCliOnce).not.toHaveBeenCalled();
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
  test('pre-installs posthog-cli when run resolves, after the intro gate', async () => {
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
