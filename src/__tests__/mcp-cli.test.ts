// Mock variable names must be unique across .test.ts files (shared TS scope).
const mockBuildSessionMcp = jest.fn((args: Record<string, unknown>) => args);
const mockStartTUIMcp = jest.fn(() => ({
  unmount: jest.fn(),
  store: { session: {} },
}));
const mockReadApiKeyFromEnvMcp = jest.fn(() => undefined as string | undefined);

jest.mock('@lib/wizard-session', () => ({
  buildSession: mockBuildSessionMcp,
}));
jest.mock('@ui/tui/start-tui', () => ({
  startTUI: mockStartTUIMcp,
}));
jest.mock('@utils/env-api-key', () => ({
  readApiKeyFromEnv: mockReadApiKeyFromEnvMcp,
}));
jest.mock('@lib/programs/program-registry', () => ({
  Program: { McpAdd: 'mcp-add', McpRemove: 'mcp-remove' },
  PROGRAM_REGISTRY: [],
  getSubcommandPrograms: () => [],
  getProgramConfig: () => ({}),
}));

import type { Arguments } from 'yargs';
import { mcpAddCommand } from '../commands/mcp/add';
import { mcpRemoveCommand } from '../commands/mcp/remove';
import { mcpCommand } from '../commands/mcp';

function makeArgv(extra: Record<string, unknown> = {}): Arguments {
  return { _: [], $0: 'wizard', ...extra } as Arguments;
}

async function flush() {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('mcpCommand (parent)', () => {
  test('exposes add and remove as children, no handler of its own', () => {
    expect(mcpCommand.handler).toBeUndefined();
    expect(mcpCommand.children).toEqual([mcpAddCommand, mcpRemoveCommand]);
  });
});

describe('mcp add handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('starts the TUI with the McpAdd program id', async () => {
    mcpAddCommand.handler!(makeArgv());
    await flush();
    expect(mockStartTUIMcp).toHaveBeenCalledWith(expect.any(String), 'mcp-add');
  });

  test('passes --local through as localMcp', async () => {
    mcpAddCommand.handler!(makeArgv({ local: true }));
    await flush();
    expect(mockBuildSessionMcp).toHaveBeenCalledWith(
      expect.objectContaining({ localMcp: true }),
    );
  });

  test('passes --api-key through to buildSession', async () => {
    mcpAddCommand.handler!(makeArgv({ apiKey: 'phx_from_flag' }));
    await flush();
    expect(mockBuildSessionMcp).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'phx_from_flag' }),
    );
  });

  test('falls back to readApiKeyFromEnv when --api-key is omitted', async () => {
    mockReadApiKeyFromEnvMcp.mockReturnValueOnce('phx_from_env');
    mcpAddCommand.handler!(makeArgv());
    await flush();
    expect(mockBuildSessionMcp).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'phx_from_env' }),
    );
  });

  test('parses --features into a trimmed array', async () => {
    mcpAddCommand.handler!(makeArgv({ features: 'flags, errors , logs' }));
    await flush();
    expect(mockBuildSessionMcp).toHaveBeenCalledWith(
      expect.objectContaining({ mcpFeatures: ['flags', 'errors', 'logs'] }),
    );
  });
});

describe('mcp remove handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('starts the TUI with the McpRemove program id', async () => {
    mcpRemoveCommand.handler!(makeArgv());
    await flush();
    expect(mockStartTUIMcp).toHaveBeenCalledWith(
      expect.any(String),
      'mcp-remove',
    );
  });

  test('passes --local through as localMcp', async () => {
    mcpRemoveCommand.handler!(makeArgv({ local: true }));
    await flush();
    expect(mockBuildSessionMcp).toHaveBeenCalledWith(
      expect.objectContaining({ localMcp: true }),
    );
  });
});
