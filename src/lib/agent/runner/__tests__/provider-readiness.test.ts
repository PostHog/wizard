import { WizardReadiness } from '@lib/health-checks';
import { Harness, Sequence } from '@lib/constants';
import { buildSession } from '@lib/wizard-session';
import type { ProgramRun } from '@lib/agent/runner/shared/types';
import type { ProgramConfig } from '@lib/programs/program-step';

const mocks = vi.hoisted(() => ({
  bootstrapProgram: vi.fn(),
  enforceProviderReadiness: vi.fn(),
  resolveBinding: vi.fn(),
  runSequence: vi.fn(),
  flushScanReport: vi.fn(),
  registerCleanup: vi.fn(),
  setTag: vi.fn(),
  wizardCapture: vi.fn(),
}));

vi.mock('@lib/agent/runner/shared/bootstrap', () => ({
  bootstrapProgram: mocks.bootstrapProgram,
}));

vi.mock('@lib/health-checks/provider-readiness', () => ({
  enforceModelProviderReadiness: mocks.enforceProviderReadiness,
}));

vi.mock('@lib/agent/runner/switchboard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lib/agent/runner/switchboard')>()),
  resolveBinding: mocks.resolveBinding,
  getSequence: () => ({ run: mocks.runSequence }),
}));

vi.mock('@lib/yara-hooks', () => ({
  flushScanReport: mocks.flushScanReport,
}));

vi.mock('@utils/wizard-abort', () => ({
  registerCleanup: mocks.registerCleanup,
  wizardAbort: vi.fn(),
}));

vi.mock('@utils/analytics', () => ({
  analytics: {
    setTag: mocks.setTag,
    wizardCapture: mocks.wizardCapture,
  },
}));

const RUN_CONFIG = {
  integrationLabel: 'test',
} as ProgramRun;

function programWithSteps(steps: ProgramConfig['steps']): ProgramConfig {
  return {
    id: 'posthog-integration',
    steps,
  } as ProgramConfig;
}

describe('runner provider readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bootstrapProgram.mockResolvedValue({
      skillsBaseUrl: 'https://example.com',
      credentials: {},
      wizardFlags: {},
      wizardFlagPayloads: {},
      wizardMetadata: {},
      project: null,
      triageProvider: undefined,
    });
    mocks.resolveBinding.mockReturnValue({
      sequence: Sequence.linear,
      harness: Harness.pi,
      model: 'openai/gpt-5.6-terra',
      thinkingLevel: undefined,
    });
    mocks.enforceProviderReadiness.mockResolvedValue(undefined);
    mocks.runSequence.mockResolvedValue(undefined);
  });

  it('checks the resolved model even when the TUI cached readiness', async () => {
    const session = buildSession({ installDir: '/tmp/project' });
    session.readinessResult = {
      decision: WizardReadiness.No,
      health: {} as never,
      reasons: ['cached pre-flight result'],
    };

    const { runProgram } = await import('@lib/agent/runner');
    await runProgram(
      session,
      RUN_CONFIG,
      programWithSteps([
        { id: 'health-check', label: 'Health check', screenId: 'health-check' },
      ]),
    );

    expect(mocks.enforceProviderReadiness).toHaveBeenCalledOnce();
    expect(mocks.enforceProviderReadiness).toHaveBeenCalledWith(
      'openai/gpt-5.6-terra',
    );
    expect(mocks.runSequence).toHaveBeenCalledOnce();
  });

  it('does not add provider checks to programs without health readiness', async () => {
    const session = buildSession({ installDir: '/tmp/project' });

    const { runProgram } = await import('@lib/agent/runner');
    await runProgram(
      session,
      RUN_CONFIG,
      programWithSteps([{ id: 'run', label: 'Run', screenId: 'run' }]),
    );

    expect(mocks.enforceProviderReadiness).not.toHaveBeenCalled();
    expect(mocks.runSequence).toHaveBeenCalledOnce();
  });
});
