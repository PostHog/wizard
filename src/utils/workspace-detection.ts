import fs from 'fs';
import path from 'path';
import fg from 'fast-glob';

export type WorkspaceType =
  | 'pnpm'
  | 'yarn'
  | 'npm'
  | 'nx'
  | 'turbo'
  | 'lerna'
  | 'heuristic';

export type WorkspaceInfo = {
  type: WorkspaceType;
  rootDir: string;
  memberDirs: string[];
};

const IGNORE_DIRS = [
  'node_modules',
  'dist',
  'build',
  '.venv',
  'venv',
  'env',
  '__pycache__',
  '.git',
  '.next',
  '.nuxt',
  '.output',
  'vendor',
  'Pods',
  'DerivedData',
  '.build',
  '.gradle',
];

const IGNORE_PATTERNS = IGNORE_DIRS.map((d) => `**/${d}/**`);

/** Non-JS project indicator file globs at depth 1-2. */
const POLYGLOT_FILE_INDICATORS = [
  // Python (Django, Flask, FastAPI, generic)
  '*/pyproject.toml',
  '*/*/pyproject.toml',
  '*/manage.py',
  '*/*/manage.py',
  '*/requirements.txt',
  '*/*/requirements.txt',
  // PHP/Laravel
  '*/composer.json',
  '*/*/composer.json',
  '*/artisan',
  '*/*/artisan',
  // Android
  '*/build.gradle',
  '*/*/build.gradle',
  '*/build.gradle.kts',
  '*/*/build.gradle.kts',
  // Swift/iOS
  '*/Package.swift',
  '*/*/Package.swift',
];

/** Xcode project directory globs at depth 1-2. */
const XCODEPROJ_GLOBS = ['*/*.xcodeproj', '*/*/*.xcodeproj'];

/** Detect workspace root and resolve member directories. Returns null if not a monorepo. */
export async function detectWorkspaces(
  rootDir: string,
): Promise<WorkspaceInfo | null> {
  // Try formal workspace detection first
  const formal =
    (await detectPnpmWorkspace(rootDir)) ??
    (await detectNpmOrYarnWorkspace(rootDir)) ??
    (await detectLernaWorkspace(rootDir)) ??
    (await detectNxWorkspace(rootDir));

  if (formal) {
    // Supplement with non-JS project roots that live outside the formal workspace
    return supplementWithPolyglotProjects(formal);
  }

  // Fall back to heuristic scan
  return detectHeuristic(rootDir);
}

/**
 * Detect pnpm workspaces from pnpm-workspace.yaml
 */
async function detectPnpmWorkspace(
  rootDir: string,
): Promise<WorkspaceInfo | null> {
  const workspaceFile = path.join(rootDir, 'pnpm-workspace.yaml');

  let content: string;
  try {
    content = await fs.promises.readFile(workspaceFile, 'utf-8');
  } catch {
    return null;
  }

  const patterns = parsePnpmWorkspaceYaml(content);
  if (patterns.length === 0) {
    return null;
  }

  // Check if turbo.json exists — if so, label as turbo
  const type: WorkspaceType = (await fileExists(
    path.join(rootDir, 'turbo.json'),
  ))
    ? 'turbo'
    : 'pnpm';

  const memberDirs = await resolveGlobPatterns(rootDir, patterns);
  if (memberDirs.length === 0) {
    return null;
  }

  return { type, rootDir, memberDirs };
}

/**
 * Detect npm/yarn workspaces from package.json "workspaces" field
 */
async function detectNpmOrYarnWorkspace(
  rootDir: string,
): Promise<WorkspaceInfo | null> {
  const packageJsonPath = path.join(rootDir, 'package.json');

  let content: string;
  try {
    content = await fs.promises.readFile(packageJsonPath, 'utf-8');
  } catch {
    return null;
  }

  let packageJson: { workspaces?: string[] | { packages?: string[] } };
  try {
    packageJson = JSON.parse(content);
  } catch {
    return null;
  }

  // workspaces can be an array or an object with a "packages" field (yarn classic)
  let patterns: string[];
  if (Array.isArray(packageJson.workspaces)) {
    patterns = packageJson.workspaces;
  } else if (Array.isArray(packageJson.workspaces?.packages)) {
    patterns = packageJson.workspaces.packages;
  } else {
    return null;
  }

  if (patterns.length === 0) {
    return null;
  }

  // Check if turbo.json exists — if so, label as turbo
  const hasTurbo = await fileExists(path.join(rootDir, 'turbo.json'));
  // Detect yarn vs npm by lockfile
  const hasYarnLock = await fileExists(path.join(rootDir, 'yarn.lock'));

  const type: WorkspaceType = hasTurbo ? 'turbo' : hasYarnLock ? 'yarn' : 'npm';

  const memberDirs = await resolveGlobPatterns(rootDir, patterns);
  if (memberDirs.length === 0) {
    return null;
  }

  return { type, rootDir, memberDirs };
}

/**
 * Detect Lerna workspaces from lerna.json
 */
async function detectLernaWorkspace(
  rootDir: string,
): Promise<WorkspaceInfo | null> {
  const lernaPath = path.join(rootDir, 'lerna.json');

  let content: string;
  try {
    content = await fs.promises.readFile(lernaPath, 'utf-8');
  } catch {
    return null;
  }

  let lernaConfig: { packages?: string[] };
  try {
    lernaConfig = JSON.parse(content);
  } catch {
    return null;
  }

  const patterns = lernaConfig.packages;
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return null;
  }

  const memberDirs = await resolveGlobPatterns(rootDir, patterns);
  if (memberDirs.length === 0) {
    return null;
  }

  return { type: 'lerna', rootDir, memberDirs };
}

/**
 * Detect Nx workspaces from nx.json
 */
async function detectNxWorkspace(
  rootDir: string,
): Promise<WorkspaceInfo | null> {
  const nxPath = path.join(rootDir, 'nx.json');

  if (!(await fileExists(nxPath))) {
    return null;
  }

  // Nx projects can be defined via project.json files in subdirectories
  const projectJsonPaths = await fg(['*/project.json', '*/*/project.json'], {
    cwd: rootDir,
    ignore: IGNORE_PATTERNS,
    onlyFiles: true,
  });

  if (projectJsonPaths.length === 0) {
    // Nx might use package.json workspaces — fall through to that detector
    return null;
  }

  const memberDirs = projectJsonPaths.map((p) =>
    path.resolve(rootDir, path.dirname(p)),
  );

  return { type: 'nx', rootDir, memberDirs: [...new Set(memberDirs)] };
}

/** Heuristic fallback: scan for 2+ project roots at depth 1-2. */
async function detectHeuristic(rootDir: string): Promise<WorkspaceInfo | null> {
  // Find project indicators at depth 1 and 2 for ALL supported frameworks
  const fileIndicators = await fg(
    [
      // JS/TS
      '*/package.json',
      '*/*/package.json',
      ...POLYGLOT_FILE_INDICATORS,
    ],
    {
      cwd: rootDir,
      ignore: IGNORE_PATTERNS,
      onlyFiles: true,
    },
  );

  const xcodeprojDirs = await fg(XCODEPROJ_GLOBS, {
    cwd: rootDir,
    ignore: IGNORE_PATTERNS,
    onlyDirectories: true,
  });

  // Combine all indicators — get parent directories
  const allIndicators = [
    ...fileIndicators.map((f) => path.dirname(f)),
    // For .xcodeproj, the project root is the parent of the .xcodeproj dir
    ...xcodeprojDirs.map((d) => path.dirname(d)),
  ];

  // Deduplicate to unique directories
  const candidateDirs = [
    ...new Set(allIndicators.map((rel) => path.resolve(rootDir, rel))),
  ];

  // Filter out the root itself (don't count root-level indicators)
  const nonRootDirs = candidateDirs.filter(
    (dir) => path.resolve(dir) !== path.resolve(rootDir),
  );

  // Only trigger if 2+ candidate dirs found
  if (nonRootDirs.length < 2) {
    return null;
  }

  return { type: 'heuristic', rootDir, memberDirs: nonRootDirs };
}

/** Parse pnpm-workspace.yaml to extract package glob patterns. */
export function parsePnpmWorkspaceYaml(content: string): string[] {
  const patterns: string[] = [];
  const lines = content.split('\n');

  let inPackages = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '') {
      continue;
    }

    if (trimmed === 'packages:') {
      inPackages = true;
      continue;
    }

    // If we hit a new top-level key, stop reading packages
    if (inPackages && !line.startsWith(' ') && !line.startsWith('\t')) {
      break;
    }

    if (inPackages && trimmed.startsWith('-')) {
      // Extract pattern: remove leading "- " and surrounding quotes
      let pattern = trimmed.slice(1).trim();
      pattern = pattern.replace(/^['"]|['"]$/g, '');

      // Skip negated patterns (e.g., "!packages/internal")
      if (pattern.startsWith('!')) {
        continue;
      }

      if (pattern) {
        patterns.push(pattern);
      }
    }
  }

  return patterns;
}

/**
 * Resolve workspace glob patterns to actual directory paths.
 */
async function resolveGlobPatterns(
  rootDir: string,
  patterns: string[],
): Promise<string[]> {
  const dirs: string[] = [];

  for (const pattern of patterns) {
    const matches = await fg(pattern, {
      cwd: rootDir,
      onlyDirectories: true,
      ignore: IGNORE_PATTERNS,
    });

    for (const match of matches) {
      dirs.push(path.resolve(rootDir, match));
    }
  }

  return [...new Set(dirs)];
}

/** Add non-JS project roots (Python, PHP, mobile) that live outside JS workspace configs. */
async function supplementWithPolyglotProjects(
  workspace: WorkspaceInfo,
): Promise<WorkspaceInfo> {
  const { rootDir, memberDirs } = workspace;

  // Scan for non-JS project indicators at depth 1 and 2
  const fileIndicators = await fg(POLYGLOT_FILE_INDICATORS, {
    cwd: rootDir,
    ignore: IGNORE_PATTERNS,
    onlyFiles: true,
  });

  const xcodeprojDirs = await fg(XCODEPROJ_GLOBS, {
    cwd: rootDir,
    ignore: IGNORE_PATTERNS,
    onlyDirectories: true,
  });

  // Get parent directories of each indicator
  const candidateDirs = new Set([
    ...fileIndicators.map((f) => path.resolve(rootDir, path.dirname(f))),
    ...xcodeprojDirs.map((d) => path.resolve(rootDir, path.dirname(d))),
  ]);

  const resolvedRoot = path.resolve(rootDir);
  const existingMemberSet = new Set(memberDirs.map((d) => path.resolve(d)));

  const supplementalDirs: string[] = [];

  for (const candidate of candidateDirs) {
    // Skip the root dir itself
    if (candidate === resolvedRoot) {
      continue;
    }

    // Skip if already a formal workspace member
    if (existingMemberSet.has(candidate)) {
      continue;
    }

    // Skip if this candidate is a subdirectory of an existing member
    // (but exclude root from this check — everything is a subdir of root)
    const isSubdirOfMember = [...existingMemberSet].some(
      (member) =>
        member !== resolvedRoot && candidate.startsWith(member + path.sep),
    );
    if (isSubdirOfMember) {
      continue;
    }

    supplementalDirs.push(candidate);
  }

  if (supplementalDirs.length === 0) {
    return workspace;
  }

  return {
    ...workspace,
    memberDirs: [...memberDirs, ...supplementalDirs],
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}
