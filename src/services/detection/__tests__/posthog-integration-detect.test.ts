import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  detectExistingPostHog,
  detectMcpServer,
} from '@services/detection/integration';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ph-detect-'));
}

function writePackageJson(
  dir: string,
  pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } = {},
): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
}

describe('detectExistingPosthog', () => {
  let tmpDir: string;
  let setPosthogSdkDetected: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    setPosthogSdkDetected = vi.fn();
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const run = (dir: string) =>
    detectExistingPostHog({ setPosthogSdkDetected }, dir);

  it('reports false when no package.json exists', () => {
    run(tmpDir);
    expect(setPosthogSdkDetected).toHaveBeenCalledWith(false);
  });

  it('reports false when dependencies have no PostHog SDK', () => {
    writePackageJson(tmpDir, { dependencies: { react: '^19.0.0' } });
    run(tmpDir);
    expect(setPosthogSdkDetected).toHaveBeenCalledWith(false);
  });

  it('reports true for posthog-js in dependencies', () => {
    writePackageJson(tmpDir, { dependencies: { 'posthog-js': '^1.0.0' } });
    run(tmpDir);
    expect(setPosthogSdkDetected).toHaveBeenCalledWith(true);
  });

  it('reports true for posthog-node in devDependencies', () => {
    writePackageJson(tmpDir, { devDependencies: { 'posthog-node': '^4.0.0' } });
    run(tmpDir);
    expect(setPosthogSdkDetected).toHaveBeenCalledWith(true);
  });

  it('reports true for a PostHog SDK in a nested monorepo package', () => {
    writePackageJson(tmpDir, { dependencies: {} });
    writePackageJson(path.join(tmpDir, 'apps', 'web'), {
      dependencies: { 'posthog-js': '^1.0.0' },
    });
    run(tmpDir);
    expect(setPosthogSdkDetected).toHaveBeenCalledWith(true);
  });

  it('does not throw and reports false for an invalid install dir', () => {
    expect(() => run('/nonexistent/path')).not.toThrow();
    expect(setPosthogSdkDetected).toHaveBeenCalledWith(false);
  });
});

describe('detectMcpServer', () => {
  let tmpDir: string;
  let setMcpServerDetected: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    setMcpServerDetected = vi.fn();
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(tmpDir, file)), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, file), content);
  };

  it.each([
    [
      'a TypeScript server',
      'src/index.ts',
      "import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'; new McpServer({});",
      true,
    ],
    [
      'a Python server',
      'server.py',
      'from mcp.server.fastmcp import FastMCP\nmcp = FastMCP("x")',
      true,
    ],
    [
      'a TypeScript MCP client',
      'src/agent.ts',
      "import { Client } from '@modelcontextprotocol/sdk/client/index.js'; new Client({});",
      false,
    ],
    ['no MCP code', 'src/index.ts', 'export const x = 1;', false],
  ])(
    'reports whether %s is a server',
    async (_project, file, source, expected) => {
      write(file, source);
      await detectMcpServer({ setMcpServerDetected }, tmpDir);
      expect(setMcpServerDetected).toHaveBeenCalledWith(expected);
    },
  );

  it('reports false for an invalid install dir', async () => {
    await detectMcpServer({ setMcpServerDetected }, '/nonexistent/path');
    expect(setMcpServerDetected).toHaveBeenCalledWith(false);
  });
});
