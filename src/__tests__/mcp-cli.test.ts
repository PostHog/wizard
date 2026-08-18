// Mock variable names must be unique across .test.ts files (shared TS scope).
// vi.hoisted() (not plain top-level const) because commands/mcp/*.ts import
// analytics.ts statically, which now statically imports wizard-session.ts
// for reportableDiscoveredFeatures(). That eager import graph resolves
// before this file's own top-level statements run, so a plain const here
// would still be in its temporal dead zone when the mock factory needs it.
const { mockBuildSessionMcp, mockStartTUIMcp, mockReadApiKeyFromEnvMcp } =
  vi.hoisted(() => ({
    mockBuildSessionMcp: vi.fn((args: Record<string, unknown>) => args),
    mockStartTUIMcp: vi.fn(() => ({
      unmount: vi.fn(),
      store: { session: {} },
    })),
    mockReadApiKeyFromEnvMcp: vi.fn(() => undefined as string | undefined),
  }));

vi.mock('@lib/wizard-session', () => ({
  buildSession: mockBuildSessionMcp,
  // analytics.ts imports this for sessionProperties(); unused by this
  // suite's assertions, stubbed only so the mocked module still satisfies
  // the real module's exports.
  reportableDiscoveredFeatures: () => undefined,
}));
vi.mock('@ui/tui/start-tui', () => ({
  startTUI: mockStartTUIMcp,
}));
vi.mock('@utils/env-api-key', () => ({
  readApiKeyFromEnv: mockReadApiKeyFromEnvMcp,
}));
vi.mock('@lib/programs/program-registry', () => ({
  Program: {
    McpAdd: 'mcp-add',
    McpRemove: 'mcp-remove',
    McpTutorial: 'mcp-tutorial',
  },
  PROGRAM_REGISTRY: [],
  getSubcommandPrograms: () => [],
  getProgramConfig: () => ({}),
}));

import type { Arguments } from 'yargs';
import { mcpAddCommand } from '../commands/mcp/add';
import { mcpRemoveCommand } from '../commands/mcp/remove';
import { mcpTutorialCommand } from '../commands/mcp/tutorial';
import { mcpCommand } from '../commands/mcp';
import { parseCommand } from './helpers/parse-command.no-jest';

function makeArgv(extra: Record<string, unknown> = {}): Arguments {
  return { _: [], $0: 'wizard', ...extra } as Arguments;
}

async function flush() {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('mcpCommand (parent)', () => {
  test('exposes add, remove, and tutorial as children, no handler of its own', () => {
    expect(mcpCommand.handler).toBeUndefined();
    expect(mcpCommand.children).toEqual([
      mcpAddCommand,
      mcpRemoveCommand,
      mcpTutorialCommand,
    ]);
  });
});

describe('mcp add handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

describe('mcp parsing (end-to-end yargs)', () => {
  test('mcp add camelCases --api-key and parses its flags', async () => {
    const argv = await parseCommand(
      mcpCommand,
      'mcp add --api-key phx_x --local --features flags,errors',
    );
    expect(argv.apiKey).toBe('phx_x');
    expect(argv.local).toBe(true);
    expect(argv.features).toBe('flags,errors');
  });

  test('mcp remove parses --local', async () => {
    const argv = await parseCommand(mcpCommand, 'mcp remove --local');
    expect(argv.local).toBe(true);
  });
});

describe('mcp remove handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
