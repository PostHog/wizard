import { runProgram } from '../index';

// The runner fork routes on the cloud outcome + whether a fallback is declared.
// Mock the heavy collaborators so the test asserts only the routing decision.
jest.mock('../shared/bootstrap', () => ({
  bootstrapProgram: jest.fn().mockResolvedValue({ wizardFlags: {} }),
  shouldDisableAsk: jest.fn(),
}));
jest.mock('../cloud', () => ({ runCloudProgram: jest.fn() }));
jest.mock('../linear', () => ({ runLinearProgram: jest.fn() }));
jest.mock('../orchestrator/orchestrator-runner', () => ({
  runOrchestrator: jest.fn(),
}));
jest.mock('../../agent-interface', () => ({
  isOrchestratorEnabled: jest.fn().mockReturnValue(false),
}));
jest.mock('../../../../ui', () => ({
  getUI: () => ({ log: { info: jest.fn() } }),
}));
jest.mock('../../../../utils/wizard-abort', () => ({
  wizardAbort: jest.fn(),
  WizardError: class WizardError extends Error {},
}));

describe('runProgram — cloud fork + failover', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { runCloudProgram } = require('../cloud');
  const { runLinearProgram } = require('../linear');
  const { wizardAbort } = require('../../../../utils/wizard-abort');
  /* eslint-enable @typescript-eslint/no-require-imports */

  const session = { installDir: '/tmp/x' } as never;
  const programConfig = { id: 'audit' } as never;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('runs cloud and stops there when it succeeds — no fallback, no linear', async () => {
    runCloudProgram.mockResolvedValue('ok');
    const fallback = jest.fn();

    await runProgram(
      session,
      { executor: 'cloud', fallback } as never,
      programConfig,
    );

    expect(runCloudProgram).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
    expect(runLinearProgram).not.toHaveBeenCalled();
    expect(wizardAbort).not.toHaveBeenCalled();
  });

  it('falls over to the linear pipeline with the resolved fallback run when cloud fails', async () => {
    runCloudProgram.mockResolvedValue('failed');
    const fallbackRun = { integrationLabel: 'audit' };
    const fallback = jest.fn().mockResolvedValue(fallbackRun);

    await runProgram(
      session,
      { executor: 'cloud', fallback } as never,
      programConfig,
    );

    expect(fallback).toHaveBeenCalledWith(session);
    // The fallback's run — not the cloud config — is what reaches the linear arm.
    expect(runLinearProgram).toHaveBeenCalledTimes(1);
    expect(runLinearProgram.mock.calls[0][1]).toBe(fallbackRun);
    expect(wizardAbort).not.toHaveBeenCalled();
  });

  it('aborts (never runs the cloud config on the linear arm) when cloud fails with no fallback', async () => {
    runCloudProgram.mockResolvedValue('failed');

    await runProgram(session, { executor: 'cloud' } as never, programConfig);

    expect(wizardAbort).toHaveBeenCalledTimes(1);
    expect(runLinearProgram).not.toHaveBeenCalled();
  });

  it('never touches the cloud arm for a linear program', async () => {
    await runProgram(session, { executor: 'linear' } as never, programConfig);

    expect(runCloudProgram).not.toHaveBeenCalled();
    expect(runLinearProgram).toHaveBeenCalledTimes(1);
  });
});
