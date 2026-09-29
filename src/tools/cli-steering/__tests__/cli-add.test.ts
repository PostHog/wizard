const {
  mockCliAddInstallOrUpdatePostHogCli,
  mockCliAddInstallSteeringSnippet,
  mockCliAddWizardCapture,
  mockCliAddLog,
} = vi.hoisted(() => ({
  mockCliAddInstallOrUpdatePostHogCli: vi.fn(),
  mockCliAddInstallSteeringSnippet: vi.fn(),
  mockCliAddWizardCapture: vi.fn(),
  mockCliAddLog: {
    intro: vi.fn(),
    outro: vi.fn(),
    log: {
      error: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      step: vi.fn(),
    },
  },
}));

vi.mock(import('@shared/install-cli-steering'), () => ({
  CLI_STEERING_TARGETS: [
    {
      id: 'codex',
      name: 'Codex',
      instructionsPath: () => '/home/user/.codex/AGENTS.md',
      isDetected: () => true,
    },
  ],
  detectTargets: vi.fn(),
  findTarget: vi.fn(() => ({
    id: 'codex',
    name: 'Codex',
    instructionsPath: () => '/home/user/.codex/AGENTS.md',
    isDetected: () => true,
  })),
  installOrUpdatePostHogCli: mockCliAddInstallOrUpdatePostHogCli,
  installSteeringSnippet: mockCliAddInstallSteeringSnippet,
}));
vi.mock(import('@utils/analytics'), () => ({
  analytics: {
    wizardCapture: mockCliAddWizardCapture,
    flush: vi.fn().mockResolvedValue(undefined),
  } as never,
}));

import { runCliAdd } from '..';

describe('cli add', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCliAddInstallOrUpdatePostHogCli.mockReturnValue({ success: true });
    mockCliAddInstallSteeringSnippet.mockReturnValue({
      success: true,
      filePath: '/home/user/.codex/AGENTS.md',
    });
  });

  const run = () => runCliAdd({ agent: 'codex' }, { log: mockCliAddLog });

  it('installs or updates the CLI before installing steering', async () => {
    const code = await run();

    expect(mockCliAddInstallOrUpdatePostHogCli).toHaveBeenCalledTimes(1);
    expect(mockCliAddInstallSteeringSnippet).toHaveBeenCalledWith(
      '/home/user/.codex/AGENTS.md',
    );
    expect(
      mockCliAddInstallOrUpdatePostHogCli.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mockCliAddInstallSteeringSnippet.mock.invocationCallOrder[0],
    );
    expect(code).toBe(0);
  });

  it('does not install steering when the CLI install fails', async () => {
    mockCliAddInstallOrUpdatePostHogCli.mockReturnValue({
      success: false,
      error: 'npm failed',
    });

    const code = await run();

    expect(mockCliAddInstallSteeringSnippet).not.toHaveBeenCalled();
    expect(mockCliAddLog.log.error).toHaveBeenCalledWith(
      'Failed to install or update PostHog CLI: npm failed',
    );
    expect(code).toBe(1);
  });
});
