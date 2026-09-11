import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  realpathSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { findMcpServers } from '../mcp-analytics/detect';

vi.mock('@utils/analytics', () => ({
  analytics: { captureException: vi.fn() },
}));
let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-packages-')));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});
function file(name: string, contents: string): void {
  mkdirSync(dirname(join(root, name)), { recursive: true });
  writeFileSync(join(root, name), contents);
}
function manifest(directory: string, data: Record<string, unknown>): void {
  file(`${directory}/package.json`, JSON.stringify(data));
}
const server =
  "import { Server } from '@modelcontextprotocol/server'; export const createServer = () => new Server({name: 'example'});";

describe('MCP application suggestions', () => {
  it('suggests deployable workspace consumers instead of their shared factory', async () => {
    manifest('packages/common', {
      name: '@example/common',
      exports: './src/server.ts',
    });
    file('packages/common/src/server.ts', server);
    manifest('packages/bridge', {
      name: '@example/bridge',
      dependencies: { '@example/common': 'workspace:*' },
    });
    for (const app of ['search', 'reports']) {
      manifest(`apps/${app}`, {
        name: `example-${app}`,
        dependencies: { '@example/bridge': 'workspace:*' },
      });
      file(`apps/${app}/wrangler.jsonc`, '{"main":"src/app.ts"}');
      file(
        `apps/${app}/src/app.ts`,
        "import { createMcpApp } from '@example/bridge'; export default createMcpApp();",
      );
    }
    manifest('apps/runtime-client', {
      name: 'example-client',
      scripts: { start: 'node index.js' },
      dependencies: { '@example/common': 'workspace:*' },
    });
    file(
      'apps/runtime-client/src/index.ts',
      "import { MCPClient } from '@example/common'; new MCPClient({});",
    );
    manifest('apps/client', {
      name: 'client',
      scripts: { start: 'node index.js' },
      devDependencies: { '@example/common': 'workspace:*' },
    });
    const scan = await findMcpServers(root);
    expect(scan.candidates).toEqual(['apps/reports', 'apps/search']);
    expect(scan.packageNames).toEqual({
      'apps/reports': 'example-reports',
      'apps/search': 'example-search',
    });
  });

  it('groups transport files and includes a sibling server that calls a shared factory', async () => {
    manifest('packages/common', {
      name: '@example/common',
      main: './dist/index.js',
    });
    file('packages/common/src/server.ts', server);
    for (const app of ['database', 'api']) {
      manifest(`packages/${app}`, {
        name: `@example/${app}`,
        bin: `dist/cli.js`,
        dependencies: { '@example/common': 'workspace:^' },
      });
      file(
        `packages/${app}/src/cli.ts`,
        "import { createMcpServer } from '@example/common'; createMcpServer();",
      );
    }
    file(
      'packages/database/src/http.ts',
      'createMcpHandler(() => makeServer())',
    );
    file(
      'packages/database/src/local.ts',
      'createMcpHandler(() => makeServer())',
    );
    expect((await findMcpServers(root)).candidates).toEqual([
      'packages/api',
      'packages/database',
    ]);
  });

  it('does not present a shared library as an unambiguous server app', async () => {
    manifest('.', { name: '@example/common', main: './dist/index.js' });
    file('src/server.ts', server);
    const scan = await findMcpServers(root);
    expect(scan.candidates).toEqual([]);
    expect(scan.discoveryHint).toBe('shared_library');
  });

  it('explains MCP launchers whose implementation comes from a dependency', async () => {
    manifest('.', {
      name: '@example/mcp',
      mcpName: 'example/mcp',
      bin: 'cli.js',
      dependencies: { 'example-engine': '^1.0.0' },
    });
    file('cli.js', "const { serve } = require('example-engine/mcp'); serve();");
    const scan = await findMcpServers(root);
    expect(scan.candidates).toEqual([]);
    expect(scan.discoveryHint).toBe('launcher');
  });

  it('keeps an ordinary client out of the server suggestions', async () => {
    manifest('.', {
      name: 'example-app',
      scripts: { start: 'node src/client.js' },
      dependencies: { '@modelcontextprotocol/sdk': '^1.29.0' },
    });
    file(
      'src/client.js',
      "import { Client } from '@modelcontextprotocol/sdk/client/index.js'; new Client({});",
    );
    const scan = await findMcpServers(root);
    expect(scan.candidates).toEqual([]);
    expect(scan.discoveryHint).toBeUndefined();
  });

  it('groups a standalone runnable server without requiring generated bin files', async () => {
    manifest('.', {
      name: 'example-server',
      bin: { 'example-mcp': 'dist/main.js' },
    });
    file('src/index.ts', server);
    expect((await findMcpServers(root)).candidates).toEqual(['.']);
  });

  it('recognizes a nested worker whose workspace dependency is outside the scan', async () => {
    manifest('.', {
      name: 'example-worker',
      dependencies: { '@example/mcp-common': 'workspace:*' },
    });
    file('wrangler.toml', 'main = "src/app.ts"');
    file(
      'src/app.ts',
      "import { createMcpApp } from '@example/mcp-common'; export default createMcpApp();",
    );
    expect((await findMcpServers(root)).candidates).toEqual(['.']);
  });

  it('resolves consumers across cyclic workspace dependencies without suggesting clients', async () => {
    manifest('packages/one', {
      name: '@example/one',
      dependencies: { '@example/two': 'workspace:*' },
    });
    manifest('packages/two', {
      name: '@example/two',
      dependencies: { '@example/one': 'workspace:*' },
    });
    file('packages/one/src/server.ts', server);
    manifest('apps/tools', {
      name: 'example-tools',
      bin: 'dist/cli.js',
      dependencies: { '@example/two': 'workspace:*' },
    });
    file(
      'apps/tools/src/cli.ts',
      "import { createMcpServer } from '@example/two'; createMcpServer();",
    );
    expect((await findMcpServers(root)).candidates).toEqual(['apps/tools']);
  });

  it('keeps discovery useful when a manifest is malformed', async () => {
    file('package.json', '{');
    file('src/server.ts', server);
    expect((await findMcpServers(root)).candidates).toEqual(['src/server.ts']);
  });
});
