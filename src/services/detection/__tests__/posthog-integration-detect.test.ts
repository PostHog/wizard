import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scan } from '@posthog/warlock';
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

  it('reports true for Python, Go, and Rust PostHog SDKs', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'posthog>=7.40.0,<8\n',
    );
    run(tmpDir);
    expect(setPosthogSdkDetected).toHaveBeenCalledWith(true);

    const goDir = makeTmpDir();
    try {
      fs.writeFileSync(
        path.join(goDir, 'go.mod'),
        'module example.com/app\n\nrequire github.com/posthog/posthog-go v1.2.3\n',
      );
      detectExistingPostHog({ setPosthogSdkDetected }, goDir);
      expect(setPosthogSdkDetected).toHaveBeenLastCalledWith(true);
    } finally {
      fs.rmSync(goDir, { recursive: true, force: true });
    }

    const rustDir = makeTmpDir();
    try {
      fs.writeFileSync(
        path.join(rustDir, 'Cargo.toml'),
        '[dependencies]\nposthog = "1.0"\n',
      );
      detectExistingPostHog({ setPosthogSdkDetected }, rustDir);
      expect(setPosthogSdkDetected).toHaveBeenLastCalledWith(true);
    } finally {
      fs.rmSync(rustDir, { recursive: true, force: true });
    }
  });

  it('does not throw and reports false for an invalid install dir', () => {
    expect(() => run('/nonexistent/path')).not.toThrow();
    expect(setPosthogSdkDetected).toHaveBeenCalledWith(false);
  });
});

describe('detectMcpServer', () => {
  let tmpDir: string;
  let setMcpServerCandidates: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    setMcpServerCandidates = vi.fn();
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
      ['src/index.ts'],
    ],
    [
      'a Python server',
      'server.py',
      'from mcp.server.fastmcp import FastMCP\nmcp = FastMCP("x")',
      ['server.py'],
    ],
    [
      'a TypeScript MCP client',
      'src/agent.ts',
      "import { Client } from '@modelcontextprotocol/sdk/client/index.js'; new Client({});",
      [],
    ],
    ['no MCP code', 'src/index.ts', 'export const x = 1;', []],
  ])(
    'records the candidates for %s',
    async (_project, file, source, expected) => {
      write(file, source);
      await detectMcpServer({ setMcpServerCandidates }, tmpDir);
      expect(setMcpServerCandidates).toHaveBeenCalledWith(expected);
    },
  );

  describe('with a candidate the scanner reads', () => {
    const python = 'from mcp.server.fastmcp import FastMCP\nmcp = FastMCP("x")';

    it('drops a path the scanner flags', async () => {
      write('server.py', python);
      vi.mocked(scan).mockResolvedValueOnce({
        matched: true,
        matches: [
          {
            rule: 'prompt_injection_instruction_override',
            metadata: { scan_context: 'input' },
            matchedStrings: [],
          },
        ],
      });
      await detectMcpServer({ setMcpServerCandidates }, tmpDir);
      expect(setMcpServerCandidates).toHaveBeenCalledWith([]);
    });

    it('keeps the path when the scanner fails', async () => {
      write('server.py', python);
      vi.mocked(scan).mockRejectedValueOnce(new Error('no engine'));
      await detectMcpServer({ setMcpServerCandidates }, tmpDir);
      expect(setMcpServerCandidates).toHaveBeenCalledWith(['server.py']);
    });
  });

  it('records no candidates for an invalid install dir', async () => {
    await detectMcpServer({ setMcpServerCandidates }, '/nonexistent/path');
    expect(setMcpServerCandidates).toHaveBeenCalledWith([]);
  });
});
