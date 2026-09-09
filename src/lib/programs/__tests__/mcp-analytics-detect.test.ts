import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  realpathSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { findMcpServers, resolveMcpTarget } from '../mcp-analytics/detect';

vi.mock('@utils/analytics', () => ({
  analytics: { captureException: vi.fn() },
}));

let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-selection-')));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function file(name: string, contents: string): string {
  const target = join(root, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
  return target;
}

describe('findMcpServers', () => {
  it.each([
    [
      'apps/tools/src/server.ts',
      "import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'; const server = new McpServer({name: 'example'});",
    ],
    [
      'packages/tools/src/main.mts',
      "import { McpServer } from '@modelcontextprotocol/server'; const server = new McpServer({name: 'example'});",
    ],
    [
      'python/server.py',
      'from mcp.server.fastmcp import FastMCP\nmcp = FastMCP("example")',
    ],
    ['python/main.py', 'from fastmcp import FastMCP\nmcp = FastMCP("example")'],
    [
      'edge/server.ts',
      'const handlers = { "tools/call": callTool, "tools/list": listTools };',
    ],
  ])('suggests a server at %s', async (name, source) => {
    file(name, source);
    const result = await findMcpServers(root);
    expect(result.candidates).toEqual([name]);
  });

  it('does not suggest clients, tests, dependencies or linked outside files', async () => {
    const source =
      "import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'; new McpServer({});";
    file(
      'src/client.ts',
      "import { Client } from '@modelcontextprotocol/sdk/client/index.js'; new Client({});",
    );
    file('node_modules/example/server.ts', source);
    file('tests/server.ts', source);
    file('src/server.test.ts', source);
    file('server.py', '# just an ordinary script');
    symlinkSync(
      join(root, 'node_modules/example/server.ts'),
      join(root, 'linked.ts'),
    );
    expect((await findMcpServers(root)).candidates).toEqual([]);
  });

  it('leaves an unrecognized custom server eligible for agent search', async () => {
    file('server.ts', 'startCustomDispatcher()');
    const result = await findMcpServers(root);
    expect(result.candidates).toEqual([]);
    expect(resolveMcpTarget(root, '.')).toEqual({ directory: root });
  });
});

describe('resolveMcpTarget', () => {
  it('runs a selected entry file from its package root, not its src directory', () => {
    file('package.json', '{}');
    file('packages/server/package.json', '{}');
    const entryPoint = file('packages/server/src/index.ts', 'startServer()');
    expect(resolveMcpTarget(root, entryPoint)).toEqual({
      directory: join(root, 'packages/server'),
      entryPoint,
    });
  });

  it('accepts an explicit directory override', () => {
    mkdirSync(join(root, 'another-server'));
    expect(resolveMcpTarget(root, 'another-server')).toEqual({
      directory: join(root, 'another-server'),
    });
  });

  it.each(['', 'missing', '.env', 'report.md'])(
    'rejects invalid or non-source input %j',
    (input) => {
      file('.env', 'EXAMPLE=value');
      file('report.md', 'example');
      expect(() => resolveMcpTarget(root, input)).toThrow();
    },
  );
});
