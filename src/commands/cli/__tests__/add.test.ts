const mockCliAddInstallOrUpdatePostHogCli = jest.fn();
const mockCliAddInstallSteeringSnippet = jest.fn();
const mockCliAddWizardCapture = jest.fn();
const mockCliAddSetUI = jest.fn();
const mockCliAddUi = {
  intro: jest.fn(),
  outro: jest.fn(),
  log: {
    error: jest.fn(),
    info: jest.fn(),
    success: jest.fn(),
    warn: jest.fn(),
  },
};

jest.mock('@steps/install-cli-steering', () => ({
  CLI_STEERING_TARGETS: [
    {
      id: 'codex',
      name: 'Codex',
      instructionsPath: () => '/home/user/.codex/AGENTS.md',
      isDetected: () => true,
    },
  ],
  detectTargets: jest.fn(),
  findTarget: jest.fn(() => ({
    id: 'codex',
    name: 'Codex',
    instructionsPath: () => '/home/user/.codex/AGENTS.md',
    isDetected: () => true,
  })),
  installOrUpdatePostHogCli: mockCliAddInstallOrUpdatePostHogCli,
  installSteeringSnippet: mockCliAddInstallSteeringSnippet,
}));
jest.mock('@ui', () => ({
  getUI: () => mockCliAddUi,
  setUI: mockCliAddSetUI,
}));
jest.mock('@ui/logging-ui', () => ({
  LoggingUI: jest.fn(),
}));
jest.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: mockCliAddWizardCapture },
}));

import { cliAddCommand } from '../add';

describe('cli add command', () => {
  const originalExit = process.exit;

  beforeEach(() => {
    jest.clearAllMocks();
    process.exit = jest.fn() as unknown as typeof process.exit;
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
