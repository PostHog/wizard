/**
 * Regression tests for the ABORT branch of `runLinearProgram`.
 *
 * A matched abort case (e.g. the self-driving skill emitting
 * `[ABORT] github connection declined`) is an expected, user-driven outcome
 * already surfaced via the error outro — it must NOT be handed to
 * `wizardAbort` as a `WizardError`, because that captures a spurious exception
 * and spawns a bogus error-tracking issue. Unmatched aborts still capture.
 */
import { runLinearProgram } from '@lib/agent/runner/sequence/linear';
import { AgentErrorType } from '@lib/agent/agent-interface';
import { wizardAbort, WizardError } from '@utils/wizard-abort';
import { analytics } from '@utils/analytics';
import type {
  ProgramRun,
  BootstrapResult,
} from '@lib/agent/runner/shared/types';
import type { ProgramConfig } from '@lib/programs/program-step';
import type { WizardSession } from '@lib/wizard-session';

vi.mock('@utils/wizard-abort', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@utils/wizard-abort')>();
  return {
    ...actual,
    // Throw so execution stops at the abort branch, mirroring process.exit().
    wizardAbort: vi.fn(() => {
      throw new Error('wizardAbort called');
    }),
    registerCleanup: vi.fn(),
  };
});

vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    captureException: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@lib/agent/agent-prompt', () => ({
  assemblePrompt: vi.fn().mockReturnValue('prompt'),
}));

vi.mock('@lib/wizard-ask-bridge', () => ({
  createWizardAskBridge: vi.fn().mockReturnValue(undefined),
}));

vi.mock('@lib/agent/claude-settings', () => ({
  restoreClaudeSettings: vi.fn(),
}));

vi.mock('@lib/agent/runner/shared/bootstrap', () => ({
  shouldDisableAsk: vi.fn().mockReturnValue(true),
  sessionToOptions: vi.fn().mockReturnValue({}),
}));

const runAgent = vi.fn();
vi.mock('@lib/agent/runner/switchboard', () => ({
  resolveHarness: vi.fn().mockReturnValue({ harness: 'test', model: 'test' }),
  getHarness: vi.fn(() => ({ run: runAgent })),
}));

vi.mock('@ui', () => ({
  getUI: vi.fn().mockReturnValue({
    spinner: vi.fn().mockReturnValue({}),
    onEnterScreen: vi.fn(),
    startRun: vi.fn(),
    requestQuestion: vi.fn(),
    setOutroData: vi.fn(),
    outro: vi.fn(),
  }),
}));

const mockWizardAbort = wizardAbort as unknown as Mock;
const mockAnalytics = analytics as unknown as {
  wizardCapture: Mock;
  captureException: Mock;
  shutdown: Mock;
};

const GITHUB_DECLINED = {
  match: /^github connection declined$/i,
  message: 'GitHub connection required',
  body: 'Run the wizard again when you are ready.',
};

const baseConfig = (): ProgramRun => ({
  integrationLabel: 'self-driving',
  spinnerMessage: 'working',
  successMessage: 'done',
  estimatedDurationMinutes: 1,
  reportFile: 'report.md',
  docsUrl: 'https://posthog.com/docs',
  abortCases: [GITHUB_DECLINED],
});

const baseBoot = (): BootstrapResult =>
  ({
    skillsBaseUrl: 'https://skills',
    projectApiKey: 'phc_test',
    host: 'https://us.posthog.com',
    accessToken: 'token',
    projectId: '1',
    cloudRegion: 'us',
    mcpUrl: 'https://mcp',
    wizardFlags: {},
    wizardMetadata: {},
    project: null,
  } as unknown as BootstrapResult);

const session = {} as unknown as WizardSession;
const programConfig = { id: 'self-driving' } as unknown as ProgramConfig;

const run = () =>
  runLinearProgram(session, baseConfig(), programConfig, baseBoot());

describe('runLinearProgram ABORT handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not capture an exception for a matched abort case', async () => {
    runAgent.mockResolvedValue({
      error: AgentErrorType.ABORT,
      message: 'github connection declined',
    });

    await expect(run()).rejects.toThrow('wizardAbort called');

    // Product-analytics signal is preserved...
    expect(mockAnalytics.wizardCapture).toHaveBeenCalledWith(
      'agent aborted',
      expect.objectContaining({ matched: 'GitHub connection required' }),
    );
    // ...but no error is handed to wizardAbort, so no exception is captured.
    expect(mockWizardAbort).toHaveBeenCalledTimes(1);
    expect(mockWizardAbort.mock.calls[0][0].error).toBeUndefined();
  });

  it('captures a WizardError for an unmatched abort case', async () => {
    runAgent.mockResolvedValue({
      error: AgentErrorType.ABORT,
      message: 'something genuinely broke',
    });

    await expect(run()).rejects.toThrow('wizardAbort called');

    expect(mockAnalytics.wizardCapture).toHaveBeenCalledWith(
      'agent aborted',
      expect.objectContaining({ matched: null }),
    );
    expect(mockWizardAbort).toHaveBeenCalledTimes(1);
    const passedError = mockWizardAbort.mock.calls[0][0].error;
    expect(passedError).toBeInstanceOf(WizardError);
    expect(passedError.context).toMatchObject({
      error_type: AgentErrorType.ABORT,
      reason: 'something genuinely broke',
    });
  });
});
