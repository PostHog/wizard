import { accessSync, constants, existsSync, realpathSync, statSync } from 'fs';
import { homedir } from 'os';
import { dirname, extname, join, resolve } from 'path';
import { boundedGlob, readFileHead } from '@utils/bounded-fs';

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
export type McpServerScan = { directory: string; candidates: string[] };

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
    (/\bnew\s+(?:McpServer|Server)\s*\(/.test(source) &&
      /@modelcontextprotocol\/(?:sdk\/server|server)/.test(source)) ||
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
  const files = await boundedGlob('**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py}', {
    cwd: target.directory,
    deep: 6,
    limit: 500,
    extraIgnore: [
      '**/tests/**',
      '**/__tests__/**',
      '**/e2e/**',
      '**/*.test.*',
      '**/*.spec.*',
      '**/*.d.ts',
    ],
  });
  const candidates = files
    .filter((file) => {
      const source = readFileHead(join(target.directory, file), 64 * 1024);
      return source !== null && hasServerSignals(source);
    })
    .sort();
  return { directory: target.directory, candidates };
}
