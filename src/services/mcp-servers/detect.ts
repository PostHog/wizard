import { accessSync, constants, existsSync, realpathSync, statSync } from 'fs';
import { homedir } from 'os';
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'path';
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
  '.go',
  '.rb',
  '.rs',
]);
const PROJECT_MARKERS = [
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'setup.py',
  'go.mod',
  'Gemfile',
  'Cargo.toml',
  '.git',
];

/** A server the user selected, or a directory they asked the agent to search. */
export type McpTarget =
  | { directory: string; entryPoint?: string; agentSearch?: never }
  | { directory: string; entryPoint?: never; agentSearch: true };
export type McpServerScan = { directory: string } & McpPackageSuggestions;

export function resolveMcpTarget(
  baseDirectory: string,
  input: string,
): McpTarget {
  const value = input.trim();
  if (!value)
    throw new Error(
      'Enter a directory or a JavaScript, TypeScript, Python, Go, Ruby or Rust server file.',
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
      'Choose a directory or a JavaScript, TypeScript, Python, Go, Ruby or Rust server file.',
    );
  }

  const base = realpathSync(resolve(baseDirectory));
  const ceiling = isWithin(base, target) ? base : undefined;
  let directory = dirname(target);
  while (!PROJECT_MARKERS.some((name) => existsSync(join(directory, name)))) {
    const parent = dirname(directory);
    if (directory === ceiling || parent === directory)
      return { directory: dirname(target), entryPoint: target };
    directory = parent;
  }
  return { directory, entryPoint: target };
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
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
    (/\bfastmcp\.FastMCP\s*\(/.test(source) &&
      /^\s*import\s+fastmcp\b/m.test(source)) ||
    (/\bMcpModule\.forRoot\s*\(/.test(source) &&
      /from\s+['"]@rekog\/mcp-nest['"]/.test(source)) ||
    (/\bmcp\.NewServer\s*\(/.test(source) &&
      /"github\.com\/modelcontextprotocol\/go-sdk\/mcp"/.test(source)) ||
    /\bMCP::Server\.new\b/.test(source) ||
    (/\bimpl\s+(?:rmcp::)?ServerHandler\s+for\b/.test(source) &&
      /\brmcp::/.test(source)) ||
    /\bcreateMcpHandler\s*\(/.test(source) ||
    (/(?:\b(?:case|when)\s+|[!=]==?\s*)["']tools\/call["']|["']tools\/call["']\s*(?:[!=]==?|:)/.test(
      source,
    ) &&
      /["']tools\/list["']/.test(source))
  );
}

const RUNS_SERVER =
  /\.(?:run|Run)\w*\s*\(|\b(?:serve|Serve)\w*\s*\(|\.(?:sse|streamable_http|http)_app\s*\(/;

/**
 * The name of the Python or Go function that returns a server this file never
 * runs. Apps call that function and run the result, so they are the servers.
 */
function serverFactoryName(source: string): string | undefined {
  const built =
    /^\s*return\s+(?:(?:fastmcp\.)?FastMCP|MCPServer|Server|mcp\.NewServer)\s*\(/m.exec(
      source,
    );
  if (!built || RUNS_SERVER.test(source)) return;
  const definitions = [
    ...source
      .slice(0, built.index)
      .matchAll(
        /^\s*(?:(?:async\s+)?def|func(?:\s*\([^)]*\))?)\s+(\w+)\s*\(/gm,
      ),
  ];
  return definitions.at(-1)?.[1];
}

function runsFactoryServer(source: string, factory: string): boolean {
  return (
    RUNS_SERVER.test(source) &&
    new RegExp(`\\b${factory}\\s*\\(`).test(source) &&
    new RegExp(
      `^\\s*(?:from\\s+\\S+\\s+)?import\\b.*\\b${factory}\\b|\\w\\.${factory}\\s*\\(`,
      'm',
    ).test(source)
  );
}

export async function findMcpServers(
  directory: string,
): Promise<McpServerScan> {
  const target = resolveMcpTarget(directory, '.');
  const sourceExtensions = '{ts,tsx,mts,cts,js,jsx,mjs,cjs,py,go,rb,rs}';
  const options = {
    cwd: target.directory,
    deep: 6,
    limit: 500,
    extraIgnore: [
      '**/{test,tests,spec,__tests__,__fixtures__,fixtures,integration-tests,e2e,_test-utils}/**',
      '**/*.test.*',
      '**/*.spec.*',
      '**/test_*.py',
      '**/*_test.py',
      '**/*_test.go',
      '**/*_spec.rb',
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
  const serverFactories: string[] = [];
  const runners = new Map<string, string>();
  for (const file of files) {
    const contents = readFileHead(join(target.directory, file), 64 * 1024);
    if (contents === null) continue;
    const source = contents.replace(/^\s*(?:\/[/*]|\*|#).*$/gm, '');
    if (!hasServerSignals(source)) {
      if (RUNS_SERVER.test(source)) runners.set(file, source);
    } else {
      const factory = serverFactoryName(source);
      if (factory === undefined) sourceCandidates.push(file);
      else serverFactories.push(factory);
    }
    if (
      /\bcreate\w*(?:Mcp|MCP)(?:Server|App|Handler)\s*(?:<[^;]+?>\s*)?\(/.test(
        source,
      )
    )
      factoryFiles.push(file);
  }
  for (const [file, source] of runners)
    if (serverFactories.some((factory) => runsFactoryServer(source, factory)))
      sourceCandidates.push(file);
  const suggestions = await suggestMcpPackages(
    sourceCandidates,
    factoryFiles,
    serverFactories.length > 0,
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
