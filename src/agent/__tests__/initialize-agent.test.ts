import {
  BASE_ALLOWED_TOOLS,
  initializeAgent,
  type AgentConfig,
} from '@agent/agent-interface';
import { WIZARD_TOOL_NAMES, createWizardToolsServer } from '@agent/tools';
import { HostResolution } from '@shared/host-resolution';
import type { WizardRunOptions } from '@utils/types';

vi.mock('@utils/analytics');
vi.mock('@utils/debug');
vi.mock('@agent/gateway-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agent/gateway-session')>()),
  gatewayAuth: vi.fn(() =>
    Promise.resolve({ gatewayUrl: 'https://gateway.test', token: 'test' }),
  ),
}));
vi.mock('@agent/tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agent/tools')>()),
  createWizardToolsServer: vi.fn(() => Promise.resolve({})),
}));
vi.mock('@agent/yara-hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agent/yara-hooks')>()),
  prewarmYaraScanner: vi.fn(() => Promise.resolve()),
}));
vi.mock('@shared/claude-settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/claude-settings')>()),
  checkAllSettingsConflicts: vi.fn(() => []),
}));

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

it('carries the run shape the caller asked for into the SDK run config', async () => {
  const outputFormat = {
    type: 'json_schema' as const,
    schema: { type: 'object' },
  };

  const runConfig = await initializeAgent(
    {
      workingDirectory: '/repo',
      programId: 'posthog-integration',
      posthogMcpUrl: 'https://mcp.test/mcp',
      posthogApiKey: 'test',
      host: HostResolution.fromApiHost('https://us.posthog.com'),
      detectPackageManager: vi.fn(),
      skillsBaseUrl: '',
      outputFormat,
      readOnly: true,
    } as AgentConfig,
    { installDir: '/repo' } as WizardRunOptions,
  );

  expect(runConfig).toMatchObject({ outputFormat, readOnly: true });
});

it('hands the run allow list to the wizard-tools server', async () => {
  const allowedTools = [WIZARD_TOOL_NAMES.publishResult];
  await initializeAgent(
    {
      workingDirectory: '/repo',
      programId: 'spend-audit',
      posthogMcpUrl: 'https://mcp.test/mcp',
      posthogApiKey: 'test',
      host: HostResolution.fromApiHost('https://us.posthog.com'),
      detectPackageManager: vi.fn(),
      skillsBaseUrl: '',
      allowedTools,
    } as AgentConfig,
    { installDir: '/repo' } as WizardRunOptions,
  );

  expect(vi.mocked(createWizardToolsServer)).toHaveBeenLastCalledWith(
    expect.objectContaining({ allowedTools }),
  );
});

it('leaves publish_result out of the tools every program gets', () => {
  expect(BASE_ALLOWED_TOOLS).toContain(WIZARD_TOOL_NAMES.publishHandoff);
  expect(BASE_ALLOWED_TOOLS).not.toContain(WIZARD_TOOL_NAMES.publishResult);
});
