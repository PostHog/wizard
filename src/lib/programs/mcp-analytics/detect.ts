import { accessSync, constants, existsSync, realpathSync, statSync } from 'fs';
import { homedir } from 'os';
import { dirname, extname, join, resolve } from 'path';
import { boundedGlob, readFileHead } from '@utils/bounded-fs';
import { suggestMcpPackages, type McpPackageSuggestions } from './packages';

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
]);
const PROJECT_MARKERS = [
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'setup.py',
  '.git',
];

export type McpTarget = { directory: string; entryPoint?: string };
export type McpServerScan = { directory: string } & McpPackageSuggestions;

export function resolveMcpTarget(
  baseDirectory: string,
  input: string,
): McpTarget {
  const value = input.trim();
  if (!value)
    throw new Error(
      'Enter a directory or a JavaScript, TypeScript or Python server file.',
    );
  const expanded =
    value === '~'
      ? homedir()
      : value.startsWith('~/')
      ? join(homedir(), value.slice(2))
      : value;
  let target: string;
  try {
    target = realpathSync(resolve(baseDirectory, expanded));
    accessSync(target, constants.R_OK);
  } catch {
    throw new Error(
      'This path could not be opened. Check that it exists and is readable.',
    );
  }

  const stat = statSync(target);
  if (stat.isDirectory()) {
    accessSync(target, constants.X_OK);
    return { directory: target };
  }
  if (!stat.isFile() || !SOURCE_EXTENSIONS.has(extname(target))) {
    throw new Error(
      'Choose a directory or a JavaScript, TypeScript or Python server file.',
    );
  }

  let directory = dirname(target);
  while (!PROJECT_MARKERS.some((name) => existsSync(join(directory, name)))) {
    const parent = dirname(directory);
    if (parent === directory)
      return { directory: dirname(target), entryPoint: target };
    directory = parent;
  }
  return { directory, entryPoint: target };
}

// These are suggestions, not an eligibility check: custom dispatchers and
// aliased constructors still have the explicit-path and agent-search routes.
function hasServerSignals(source: string): boolean {
  return (
    (/\bnew\s+(?:McpServer|Server)\s*(?:<[^;]+?>\s*)?\(/.test(source) &&
      /@modelcontextprotocol\/(?:sdk\/server|server)/.test(source)) ||
    (/\bnew\s+FastMCP\s*(?:<[^;]+?>\s*)?\(/.test(source) &&
      /from\s+['"]fastmcp['"]/.test(source)) ||
    (/\bnew\s+MCPServer\s*(?:<[^;]+?>\s*)?\(/.test(source) &&
      /from\s+['"]@mastra\/mcp['"]/.test(source)) ||
    (/\b(?:FastMCP|MCPServer|Server)\s*\(/.test(source) &&
      /\bfrom\s+(?:mcp\.server(?:\.[\w.]+)?|fastmcp)\s+import\b/.test(
        source,
      )) ||
    /\bcreateMcpHandler\s*\(/.test(source) ||
    (/["']tools\/call["']/.test(source) && /["']tools\/list["']/.test(source))
  );
}

export async function findMcpServers(
  directory: string,
): Promise<McpServerScan> {
  const target = resolveMcpTarget(directory, '.');
  const sourceExtensions = '{ts,tsx,mts,cts,js,jsx,mjs,cjs,py}';
  const options = {
    cwd: target.directory,
    deep: 6,
    limit: 500,
    extraIgnore: [
      '**/{test,tests,__tests__,__fixtures__,fixtures,integration-tests,e2e,_test-utils}/**',
      '**/*.test.*',
      '**/*.spec.*',
      '**/test_*.py',
      '**/*_test.py',
      '**/*.d.ts',
    ],
  };
  const [likelyFiles, otherFiles] = await Promise.all([
    boundedGlob(
      [
        `**/*{mcp,Mcp,MCP}*/**/*.${sourceExtensions}`,
        `**/*{server,Server}*.${sourceExtensions}`,
      ],
      options,
    ),
    boundedGlob(`**/*.${sourceExtensions}`, options),
  ]);
  const files = [...new Set([...likelyFiles, ...otherFiles])];
  const sourceCandidates: string[] = [];
  const factoryFiles: string[] = [];
  for (const file of files) {
    const contents = readFileHead(join(target.directory, file), 64 * 1024);
    if (contents === null) continue;
    const source = contents.replace(/^\s*(?:\/[/*]|\*|#).*$/gm, '');
    if (hasServerSignals(source)) sourceCandidates.push(file);
    if (
      /\bcreate\w*(?:Mcp|MCP)(?:Server|App|Handler)\s*(?:<[^;]+?>\s*)?\(/.test(
        source,
      )
    )
      factoryFiles.push(file);
  }
  const suggestions = await suggestMcpPackages(
    sourceCandidates,
    factoryFiles,
    options,
  );
  const candidates = suggestions.candidates.sort((left, right) => {
    const examplePath = /(?:^|\/)(?:examples?|templates?|demos?)(?:\/|$)/;
    return (
      Number(examplePath.test(left)) - Number(examplePath.test(right)) ||
      left.localeCompare(right)
    );
  });
  return { ...suggestions, directory: target.directory, candidates };
}
