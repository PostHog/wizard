import { describe, it, expect, vi, beforeEach } from 'vitest';

import { runRemoteProgram } from '../sequence/remote';
import { AgentErrorType } from '../../agent-interface';
import { getHarness } from '../switchboard';
import { runLinearProgram } from '../sequence/linear';

// The remote sequence drives the agents-platform harness, then either finishes
// (success) or degrades to the local linear pipeline (harness error / no remote
// arm). Mock the collaborators so the test asserts only that routing decision.
vi.mock('../switchboard', () => ({ getHarness: vi.fn() }));
vi.mock('../sequence/linear', () => ({ runLinearProgram: vi.fn() }));
vi.mock('@utils/analytics', () => ({ analytics: { shutdown: vi.fn() } }));
vi.mock('@utils/debug', () => ({ logToFile: vi.fn() }));
vi.mock('@ui', () => ({
  getUI: () => ({
    startRun: vi.fn(),
    spinner: () => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() }),
    log: { info: vi.fn() },
    setOutroData: vi.fn(),
    outro: vi.fn(),
  }),
}));

describe('runRemoteProgram — hosted arm + failover', () => {
  const session = { installDir: '/tmp/x', signup: false } as never;
  const boot = {
    credentials: { host: { appHost: 'https://us.posthog.com' } },
  } as never;
  const classicRun = { integrationLabel: 'audit' } as never;
  const remoteRun = {
    integrationLabel: 'cloud-audit',
    successMessage: 'done',
    reportFile: 'r.md',
    docsUrl: 'https://d',
  };

  const mockHarnessRun = vi.fn();
  const remoteRunResolver = vi.fn();
  const programConfig = { id: 'audit', remoteRun: remoteRunResolver } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getHarness).mockReturnValue({ run: mockHarnessRun } as never);
    remoteRunResolver.mockResolvedValue(remoteRun);
  });

  it('runs the hosted arm and stops there on success — never touches linear', async () => {
    mockHarnessRun.mockResolvedValue({});

    await runRemoteProgram(session, classicRun, programConfig, boot, false);

    expect(mockHarnessRun).toHaveBeenCalledTimes(1);
    // The harness gets the resolved REMOTE run, not the classic one passed in.
    expect(mockHarnessRun.mock.calls[0][0].config).toBe(remoteRun);
    expect(runLinearProgram).not.toHaveBeenCalled();
  });

  it('falls back to the local linear pipeline with the classic run when the hosted arm errors', async () => {
    mockHarnessRun.mockResolvedValue({ error: AgentErrorType.API_ERROR });

    await runRemoteProgram(session, classicRun, programConfig, boot, false);

    expect(runLinearProgram).toHaveBeenCalledTimes(1);
    // The classic run — not the remote config — is what reaches the local arm.
    expect(vi.mocked(runLinearProgram).mock.calls[0][1]).toBe(classicRun);
  });

  it('degrades to linear when the program declares no remote arm', async () => {
    const noRemote = { id: 'audit' } as never;

    await runRemoteProgram(session, classicRun, noRemote, boot, false);

    expect(mockHarnessRun).not.toHaveBeenCalled();
    expect(runLinearProgram).toHaveBeenCalledTimes(1);
  });
});
