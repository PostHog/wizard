const {
  mockCliAddInstallOrUpdatePostHogCli,
  mockCliAddInstallSteeringSnippet,
  mockCliAddWizardCapture,
  mockCliAddSetUI,
  mockCliAddUi,
} = vi.hoisted(() => ({
  mockCliAddInstallOrUpdatePostHogCli: vi.fn(),
  mockCliAddInstallSteeringSnippet: vi.fn(),
  mockCliAddWizardCapture: vi.fn(),
  mockCliAddSetUI: vi.fn(),
  mockCliAddUi: {
    intro: vi.fn(),
    outro: vi.fn(),
    log: {
      error: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
    },
  },
}));

vi.mock('@steps/install-cli-steering', () => ({
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
vi.mock('@ui', () => ({
  getUI: () => mockCliAddUi,
  setUI: mockCliAddSetUI,
}));
vi.mock('@ui/logging-ui', () => ({
  LoggingUI: vi.fn(),
}));
vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: mockCliAddWizardCapture },
}));

import { cliAddCommand } from '../add';

describe('cli add command', () => {
  const originalExit = process.exit;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exit = vi.fn() as unknown as typeof process.exit;
    mockCliAddInstallOrUpdatePostHogCli.mockReturnValue({ success: true });
    mockCliAddInstallSteeringSnippet.mockReturnValue({
      success: true,
      filePath: '/home/user/.codex/AGENTS.md',
    });
  });

  afterEach(() => {
    process.exit = originalExit;
  });

  async function runHandler() {
    cliAddCommand.handler?.({
      _: [],
      $0: 'wizard',
      agent: 'codex',
    });
    await new Promise((resolve) => setImmediate(resolve));
  }

  it('installs or updates the CLI before installing steering', async () => {
    await runHandler();

    expect(mockCliAddInstallOrUpdatePostHogCli).toHaveBeenCalledTimes(1);
    expect(mockCliAddInstallSteeringSnippet).toHaveBeenCalledWith(
      '/home/user/.codex/AGENTS.md',
    );
    expect(
      mockCliAddInstallOrUpdatePostHogCli.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mockCliAddInstallSteeringSnippet.mock.invocationCallOrder[0],
    );
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('does not install steering when the CLI install fails', async () => {
    mockCliAddInstallOrUpdatePostHogCli.mockReturnValue({
      success: false,
      error: 'npm failed',
    });

    await runHandler();

    expect(mockCliAddInstallSteeringSnippet).not.toHaveBeenCalled();
    expect(mockCliAddUi.log.error).toHaveBeenCalledWith(
      'Failed to install or update PostHog CLI: npm failed',
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
