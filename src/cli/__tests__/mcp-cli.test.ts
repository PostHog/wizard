// Mock variable names must be unique across .test.ts files (shared TS scope).
// Hoisted, not a plain const: the vi.mock factories below run before a
// const would initialize.
const { mockRunTuiToolMcp, mockReadApiKeyFromEnvMcp, mockAddMcpServerMcp } =
  vi.hoisted(() => ({
    mockRunTuiToolMcp: vi.fn(() => Promise.resolve(0)),
    mockReadApiKeyFromEnvMcp: vi.fn(() => undefined as string | undefined),
    mockAddMcpServerMcp: vi.fn(() => Promise.resolve(1)),
  }));

vi.mock(import('@tui'), () => ({
  runTuiTool: mockRunTuiToolMcp,
}));
vi.mock(import('@utils/env-api-key'), () => ({
  readApiKeyFromEnv: mockReadApiKeyFromEnvMcp,
}));
vi.mock(import('@tools'), async (importOriginal) => ({
  ...(await importOriginal()),
  addMcpServer: mockAddMcpServerMcp,
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

/** The session a handler ran its screens with. */
const session = (extra: Record<string, unknown>) =>
  expect.objectContaining({ session: expect.objectContaining(extra) });

/** Let a handler's dynamic import of the TUI entry settle. */
async function flush() {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
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
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });
  afterEach(() => vi.restoreAllMocks());

  test('runs the mcp-add screens and exits with their code', async () => {
    mcpAddCommand.handler!(makeArgv());
    await flush();
    expect(mockRunTuiToolMcp).toHaveBeenCalledWith('mcp-add', {
      session: expect.any(Object),
      signal: expect.any(AbortSignal),
    });
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  test('passes --local through as localMcp', async () => {
    mcpAddCommand.handler!(makeArgv({ local: true }));
    await flush();
    expect(mockRunTuiToolMcp).toHaveBeenCalledWith(
      'mcp-add',
      session({ localMcp: true }),
    );
  });

  test('passes --api-key through to the session', async () => {
    mcpAddCommand.handler!(makeArgv({ apiKey: 'phx_from_flag' }));
    await flush();
    expect(mockRunTuiToolMcp).toHaveBeenCalledWith(
      'mcp-add',
      session({ apiKey: 'phx_from_flag' }),
    );
  });

  test('falls back to readApiKeyFromEnv when --api-key is omitted', async () => {
    mockReadApiKeyFromEnvMcp.mockReturnValueOnce('phx_from_env');
    mcpAddCommand.handler!(makeArgv());
    await flush();
    expect(mockRunTuiToolMcp).toHaveBeenCalledWith(
      'mcp-add',
      session({ apiKey: 'phx_from_env' }),
    );
  });

  test('installs with no screens, and exits with that code, when the terminal has no raw mode', async () => {
    mockRunTuiToolMcp.mockRejectedValueOnce(
      new Error('Raw mode is not supported on the current process.stdin'),
    );
    const before = process.listenerCount('SIGINT');
    mcpAddCommand.handler!(makeArgv({ local: true }));
    await flush();
    expect(mockAddMcpServerMcp).toHaveBeenCalledWith(
      expect.objectContaining({ local: true }),
      expect.anything(),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
    // The console install ends on Ctrl-C as Node does: no signal listener is left.
    expect(process.listenerCount('SIGINT')).toBe(before);
  });

  test('parses --features into a trimmed array', async () => {
    mcpAddCommand.handler!(makeArgv({ features: 'flags, errors , logs' }));
    await flush();
    expect(mockRunTuiToolMcp).toHaveBeenCalledWith(
      'mcp-add',
      session({ mcpFeatures: ['flags', 'errors', 'logs'] }),
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
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });
  afterEach(() => vi.restoreAllMocks());

  test('passes --local through as localMcp', async () => {
    mcpRemoveCommand.handler!(makeArgv({ local: true }));
    await flush();
    expect(mockRunTuiToolMcp).toHaveBeenCalledWith(
      'mcp-remove',
      session({ localMcp: true }),
    );
  });
});
