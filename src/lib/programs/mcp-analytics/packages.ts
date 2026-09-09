import { dirname, extname, join } from 'path';
import {
  boundedGlob,
  readProjectFile,
  type BoundedGlobOptions,
} from '@utils/bounded-fs';

export enum McpDiscoveryHint {
  SharedLibrary = 'shared_library',
  Launcher = 'launcher',
}

export type McpPackageSuggestions = {
  candidates: string[];
  packageNames?: Record<string, string>;
  discoveryHint?: McpDiscoveryHint;
};

type ProjectPackage = {
  directory: string;
  name?: string;
  dependencies: Record<string, string>;
  runnable: boolean;
  library: boolean;
  mcpIdentity: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function strings(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function readPackage(
  directory: string,
  path: string,
  deployments: Set<string>,
): ProjectPackage | undefined {
  const source = readProjectFile(join(directory, path), 64 * 1024);
  if (source === null) return;
  try {
    const data = record(JSON.parse(source));
    const packageDir = dirname(path);
    const name = typeof data.name === 'string' ? data.name : undefined;
    const bin =
      typeof data.bin === 'string'
        ? [data.bin]
        : Object.values(strings(data.bin));
    const commands = strings(data.scripts);
    return {
      directory: packageDir,
      name,
      dependencies: {
        ...strings(data.dependencies),
        ...strings(data.optionalDependencies),
        ...strings(data.peerDependencies),
      },
      runnable:
        bin.length > 0 || !!commands.start || deployments.has(packageDir),
      library: !!data.main || !!data.exports,
      mcpIdentity:
        typeof data.mcpName === 'string' ||
        /(?:^|[-/@])mcp(?:[-/]|$)/i.test(name ?? '') ||
        Object.keys(record(data.bin)).some((key) => /mcp/i.test(key)),
    };
  } catch {
    return;
  }
}

export async function suggestMcpPackages(
  sourceCandidates: string[],
  factoryFiles: string[],
  options: BoundedGlobOptions,
): Promise<McpPackageSuggestions> {
  const metadata = await boundedGlob(
    ['**/package.json', '**/wrangler.{json,jsonc,toml}'],
    options,
  );
  const deployments = new Set(
    metadata.filter((path) => !path.endsWith('package.json')).map(dirname),
  );
  const packages = metadata
    .filter((path) => path.endsWith('package.json'))
    .map((path) => readPackage(options.cwd, path, deployments))
    .filter((pkg): pkg is ProjectPackage => !!pkg)
    .sort((a, b) => b.directory.length - a.directory.length);
  const owner = (file: string): ProjectPackage | undefined =>
    extname(file) === '.py'
      ? undefined
      : packages.find(
          (pkg) =>
            pkg.directory === '.' || file.startsWith(`${pkg.directory}/`),
        );
  const byName = new Map(
    packages.filter((pkg) => pkg.name).map((pkg) => [pkg.name, pkg]),
  );
  const direct = new Set(
    sourceCandidates.map(owner).filter((pkg): pkg is ProjectPackage => !!pkg),
  );
  const factories = new Set(factoryFiles.map(owner));
  const related = new Set(direct);
  for (const pkg of packages) {
    const dependencies = Object.entries(pkg.dependencies);
    if (
      pkg.runnable &&
      ((pkg.mcpIdentity &&
        dependencies.some(
          ([name]) => name === '@modelcontextprotocol/server',
        )) ||
        dependencies.some(
          ([name, version]) =>
            version.startsWith('workspace:') &&
            /mcp/i.test(name) &&
            !byName.has(name),
        ))
    )
      related.add(pkg);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const pkg of packages) {
      if (
        !related.has(pkg) &&
        Object.keys(pkg.dependencies).some((name) => {
          const dependency = byName.get(name);
          return dependency && related.has(dependency);
        })
      ) {
        related.add(pkg);
        changed = true;
      }
    }
  }
  const apps = new Set(
    [...related].filter(
      (pkg) => pkg.runnable && (direct.has(pkg) || factories.has(pkg)),
    ),
  );
  const consumedNames = new Set(
    packages.flatMap((pkg) => Object.keys(pkg.dependencies)),
  );
  const shared = new Set(
    [...related].filter(
      (pkg) =>
        !pkg.runnable &&
        (pkg.library || (pkg.name && consumedNames.has(pkg.name))),
    ),
  );
  const candidates = new Set<string>();
  for (const file of sourceCandidates) {
    const pkg = owner(file);
    if (pkg && apps.has(pkg)) candidates.add(pkg.directory);
    else if (!pkg || !shared.has(pkg)) candidates.add(file);
  }
  const packageNames: Record<string, string> = {};
  for (const pkg of apps) {
    candidates.add(pkg.directory);
    if (pkg.name) packageNames[pkg.directory] = pkg.name;
  }
  const root = packages.find((pkg) => pkg.directory === '.');
  return {
    candidates: [...candidates],
    ...(Object.keys(packageNames).length ? { packageNames } : {}),
    ...(!candidates.size && shared.size
      ? { discoveryHint: McpDiscoveryHint.SharedLibrary }
      : !candidates.size && root?.runnable && root.mcpIdentity
      ? { discoveryHint: McpDiscoveryHint.Launcher }
      : {}),
  };
}
