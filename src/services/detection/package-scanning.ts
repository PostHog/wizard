import { relative } from 'path';
import { safeReadFile, walkProjectFiles } from '@utils/bounded-fs';

export const POSTHOG_SDKS = new Set([
  'posthog-js',
  'posthog-node',
  'posthog-react-native',
  'posthog-android',
  'posthog-ios',
]);

export const STRIPE_SDKS = new Set([
  'stripe',
  '@stripe/stripe-js',
  '@stripe/react-stripe-js',
]);

export const MCP_SERVER_SDKS = new Set([
  '@modelcontextprotocol/sdk',
  '@modelcontextprotocol/server',
  'fastmcp',
  '@mastra/mcp',
  'mcp-handler',
]);

const PYTHON_MCP_REQUIREMENT =
  /(?:^\s*|[[,]\s*)["']?(?:mcp|fastmcp)(?:\[[^\]]*\])?\s*(?:[<>=!~;"',\s]|$)/m;

// A server ships its SDK in `dependencies`; a devDependency is a test client or an example.
function jsDependsOnMcpServerSdk(content: string): boolean {
  try {
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
    };
    return Object.keys(pkg.dependencies ?? {}).some((d) =>
      MCP_SERVER_SDKS.has(d),
    );
  } catch {
    return false;
  }
}

/** Each manifest that can declare an MCP server SDK, and how to read it. */
const MCP_SERVER_MANIFESTS: {
  file: RegExp;
  declaresSdk: (content: string) => boolean;
}[] = [
  { file: /^package\.json$/, declaresSdk: jsDependsOnMcpServerSdk },
  {
    file: /^(?:pyproject\.toml|requirements[\w.-]*\.txt)$/,
    declaresSdk: (c) => PYTHON_MCP_REQUIREMENT.test(c),
  },
  {
    file: /^go\.mod$/,
    declaresSdk: (c) => c.includes('github.com/modelcontextprotocol/go-sdk'),
  },
  { file: /^Gemfile$/, declaresSdk: (c) => /^\s*gem\s+["']mcp["']/m.test(c) },
  { file: /^Cargo\.toml$/, declaresSdk: (c) => /^\s*rmcp\s*=/m.test(c) },
];

/** Whether a manifest under installDir declares an MCP server SDK. Dependencies only, no source scan. */
export function hasMcpServerSdk(installDir: string, maxDepth = 3): boolean {
  let found = false;
  walkProjectFiles(
    installDir,
    (name, fullPath) => {
      if (found) return;
      const manifest = MCP_SERVER_MANIFESTS.find((m) => m.file.test(name));
      const content = manifest && safeReadFile(fullPath);
      found = !!content && manifest.declaresSdk(content);
    },
    maxDepth,
  );
  return found;
}

export interface PackageMatch {
  /** Path to the package.json relative to installDir */
  path: string;
  posthogSdks: string[];
  stripeSdks: string[];
}

// At most this many matches retained, regardless of monorepo package count.
const MAX_PACKAGE_MATCHES = 500;

/**
 * Find all package.json files under installDir via the shared bounded walk
 * (depth cap, ignored dirs, symlink-loop protection, per-dir entry cap).
 * Returns matches with detected SDKs.
 */
export function findPackageJsons(
  installDir: string,
  maxDepth = 3,
): PackageMatch[] {
  const matches: PackageMatch[] = [];

  walkProjectFiles(
    installDir,
    (name, fullPath) => {
      if (name !== 'package.json' || matches.length >= MAX_PACKAGE_MATCHES) {
        return;
      }
      const content = safeReadFile(fullPath);
      if (content === null) return;
      try {
        const pkg = JSON.parse(content) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const depNames = [
          ...Object.keys(pkg.dependencies ?? {}),
          ...Object.keys(pkg.devDependencies ?? {}),
        ];
        const posthogSdks = depNames.filter((d) => POSTHOG_SDKS.has(d));
        const stripeSdks = depNames.filter((d) => STRIPE_SDKS.has(d));
        matches.push({
          path: relative(installDir, fullPath) || 'package.json',
          posthogSdks,
          stripeSdks,
        });
      } catch {
        // Skip malformed package.json
      }
    },
    maxDepth,
  );

  return matches;
}
