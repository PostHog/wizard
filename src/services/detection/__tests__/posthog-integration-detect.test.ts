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
  const dependsOn = (dependencies: Record<string, string>) =>
    JSON.stringify({ dependencies });

  it.each([
    ['package.json', dependsOn({ '@modelcontextprotocol/sdk': '^1.20.0' })],
    ['package.json', dependsOn({ '@modelcontextprotocol/server': '^2.0.0' })],
    ['package.json', dependsOn({ fastmcp: '^3.0.0' })],
    ['package.json', dependsOn({ '@mastra/mcp': '^0.10.0' })],
    ['package.json', dependsOn({ 'mcp-handler': '^1.0.0' })],
    ['pyproject.toml', '[project]\ndependencies = ["mcp[cli]>=1.26"]'],
    ['pyproject.toml', '[tool.poetry.dependencies]\nmcp = "^1.26"'],
    ['requirements.txt', 'fastmcp==2.3.0'],
    [
      'go.mod',
      'module x\n\nrequire github.com/modelcontextprotocol/go-sdk v1.6.1',
    ],
    ['Gemfile', 'gem "mcp", "~> 1.8"'],
    ['Cargo.toml', '[dependencies]\nrmcp = { version = "3.8" }'],
    ['apps/server/pyproject.toml', 'dependencies = ["mcp>=2"]'],
  ])('reports true for an MCP server SDK in %s: %s', (file, content) => {
    write(file, content);
    detectMcpServer({ setMcpServerDetected }, tmpDir);
    expect(setMcpServerDetected).toHaveBeenCalledWith(true);
  });

  it.each([
    [
      'package.json',
      JSON.stringify({
        devDependencies: { '@modelcontextprotocol/sdk': '^1.20.0' },
      }),
    ],
    ['package.json', dependsOn({ react: '^19.0.0' })],
    ['pyproject.toml', '[project]\nname = "mcp"\ndependencies = ["httpx"]'],
    ['requirements.txt', 'mcp-proxy==0.8.0'],
    ['go.mod', 'module x\n\nrequire github.com/mark3labs/mcp-go v0.30.0'],
    ['Gemfile', 'gem "mcp_client"'],
    ['Cargo.toml', '[dependencies]\nrmcp-macros = "3.8"'],
  ])('reports false for %s without an MCP server SDK: %s', (file, content) => {
    write(file, content);
    detectMcpServer({ setMcpServerDetected }, tmpDir);
    expect(setMcpServerDetected).toHaveBeenCalledWith(false);
  });

  it('does not throw and reports false for an invalid install dir', () => {
    expect(() =>
      detectMcpServer({ setMcpServerDetected }, '/nonexistent/path'),
    ).not.toThrow();
    expect(setMcpServerDetected).toHaveBeenCalledWith(false);
  });
});
