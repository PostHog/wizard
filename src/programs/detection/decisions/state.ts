/** The project snapshot sent to the Decisions API: file tree, manifest heads, lockfiles and README head. Never .env or source bodies. */

import path from 'path';
import {
  walkProjectFiles,
  readFileHead,
  readProjectFile,
} from '@utils/bounded-fs';
import { PROJECT_MANIFESTS } from '../agentic';
import type { DecisionInputMessage } from './client';

export type ProjectState = {
  file_tree: string;
  manifests: Record<string, string>;
  lockfiles: string[];
  readme_head?: string;
};

const MAX_TREE_DEPTH = 4;
const MAX_TREE_FILES = 4_000;
const MAX_ENTRIES_PER_DIR = 25;
const MAX_TREE_LINES = 500;
const MAX_MANIFEST_FILES = 20;
const MANIFEST_HEAD_BYTES = 3_000;
const MANIFEST_TOTAL_BYTES = 48_000;
const README_HEAD_BYTES = 1_500;
const MAX_SUBPROJECTS = 12;

const MANIFEST_BASENAMES = new Set(
  PROJECT_MANIFESTS.filter((m) => !m.includes('/') && !m.startsWith('*')),
);

const LOCKFILE_NAMES = new Set([
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'bun.lockb',
  'bun.lock',
  'poetry.lock',
  'uv.lock',
  'Pipfile.lock',
  'Gemfile.lock',
  'composer.lock',
  'Cargo.lock',
  'go.sum',
  'mix.lock',
  'Podfile.lock',
  'gradle.lockfile',
]);

function isManifest(relPath: string, name: string): boolean {
  return (
    MANIFEST_BASENAMES.has(name) ||
    name.endsWith('.csproj') ||
    relPath.endsWith('gradle/libs.versions.toml')
  );
}

type TreeNode = { files: string[]; dirs: Map<string, TreeNode> };

function insertPath(root: TreeNode, relPath: string): void {
  const segments = relPath.split('/');
  let node = root;
  for (const segment of segments.slice(0, -1)) {
    let child = node.dirs.get(segment);
    if (!child) {
      child = { files: [], dirs: new Map() };
      node.dirs.set(segment, child);
    }
    node = child;
  }
  node.files.push(segments[segments.length - 1]);
}

/** Render relative paths as an indented tree, capped per directory and in total. */
export function renderFileTree(
  relPaths: readonly string[],
  opts: { maxEntriesPerDir?: number; maxLines?: number } = {},
): string {
  const maxEntries = opts.maxEntriesPerDir ?? MAX_ENTRIES_PER_DIR;
  const maxLines = opts.maxLines ?? MAX_TREE_LINES;
  const root: TreeNode = { files: [], dirs: new Map() };
  for (const relPath of relPaths) insertPath(root, relPath);

  const lines: string[] = [];
  let truncated = false;
  const render = (node: TreeNode, indent: string): void => {
    if (truncated) return;
    const files = [...node.files].sort();
    for (const [i, file] of files.entries()) {
      if (lines.length >= maxLines) {
        truncated = true;
        return;
      }
      if (i >= maxEntries) {
        lines.push(`${indent}… +${files.length - maxEntries} more files`);
        break;
      }
      lines.push(`${indent}${file}`);
    }
    const dirs = [...node.dirs.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    for (const [i, [name, child]] of dirs.entries()) {
      if (lines.length >= maxLines) {
        truncated = true;
        return;
      }
      if (i >= maxEntries) {
        lines.push(`${indent}… +${dirs.length - maxEntries} more directories`);
        break;
      }
      lines.push(`${indent}${name}/`);
      render(child, `${indent}  `);
    }
  };
  render(root, '');
  if (truncated) lines.push('… (tree truncated)');
  return lines.join('\n');
}

/** A package.json trimmed to its classification fields; other manifests as a head. */
function manifestContent(fullPath: string, name: string): string | null {
  if (name === 'package.json') {
    const raw = readProjectFile(fullPath);
    if (raw) {
      try {
        const pkg = JSON.parse(raw) as Record<string, unknown>;
        return JSON.stringify({
          name: pkg.name,
          workspaces: pkg.workspaces,
          scripts: pkg.scripts,
          dependencies: pkg.dependencies,
          devDependencies: pkg.devDependencies,
        });
      } catch {
        // Unparseable: fall through to the head.
      }
    }
  }
  return readFileHead(fullPath, MANIFEST_HEAD_BYTES);
}

export type ScannedProject = {
  state: ProjectState;
  /** Repo-relative dirs holding a manifest, shallowest first, root excluded. */
  subprojectDirs: string[];
};

/** Walk the project once, returning the snapshot and monorepo descent candidates. */
export function scanProject(installDir: string): ScannedProject {
  const relPaths: string[] = [];
  const manifestPaths: string[] = [];
  const lockfiles: string[] = [];
  let readmePath: string | null = null;

  walkProjectFiles(
    installDir,
    (name, fullPath) => {
      const relPath = path
        .relative(installDir, fullPath)
        .split(path.sep)
        .join('/');
      // Only the tree is capped here; manifests and lockfiles keep collecting.
      if (relPaths.length < MAX_TREE_FILES) relPaths.push(relPath);
      if (isManifest(relPath, name)) manifestPaths.push(relPath);
      if (LOCKFILE_NAMES.has(name)) lockfiles.push(relPath);
      if (!readmePath && relPath.toLowerCase() === 'readme.md') {
        readmePath = relPath;
      }
    },
    MAX_TREE_DEPTH,
  );

  // Shallow manifests carry the most signal, so deep ones drop first.
  manifestPaths.sort(
    (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
  );

  const manifests: Record<string, string> = {};
  let manifestBytes = 0;
  for (const relPath of manifestPaths.slice(0, MAX_MANIFEST_FILES)) {
    const content = manifestContent(
      path.join(installDir, relPath),
      path.basename(relPath),
    );
    if (!content) continue;
    if (manifestBytes + content.length > MANIFEST_TOTAL_BYTES) break;
    manifests[relPath] = content;
    manifestBytes += content.length;
  }

  const readmeHead = readmePath
    ? readFileHead(path.join(installDir, readmePath), README_HEAD_BYTES)
    : null;

  // Each manifest-owning dir is a descent candidate; Xcode and gradle dirs resolve to their parent.
  const subprojectDirs: string[] = [];
  const seen = new Set<string>();
  for (const relPath of manifestPaths) {
    let dir = path.posix.dirname(relPath);
    if (dir.endsWith('.xcodeproj') || path.posix.basename(dir) === 'gradle') {
      dir = path.posix.dirname(dir);
    }
    if (dir === '.' || seen.has(dir)) continue;
    seen.add(dir);
    subprojectDirs.push(dir);
    if (subprojectDirs.length >= MAX_SUBPROJECTS) break;
  }

  return {
    state: {
      file_tree: renderFileTree(relPaths),
      manifests,
      lockfiles,
      ...(readmeHead ? { readme_head: readmeHead } : {}),
    },
    subprojectDirs,
  };
}

/** Render the snapshot as one user message, one text part per section. */
export function renderDecisionInput(
  state: ProjectState,
): DecisionInputMessage[] {
  const parts: string[] = [`## File tree\n${state.file_tree || '(empty)'}`];
  for (const [relPath, content] of Object.entries(state.manifests)) {
    parts.push(`## Manifest: ${relPath}\n${content}`);
  }
  parts.push(
    `## Lockfiles\n${
      state.lockfiles.length > 0 ? state.lockfiles.join('\n') : '(none)'
    }`,
  );
  if (state.readme_head) parts.push(`## README (head)\n${state.readme_head}`);
  return [
    {
      role: 'user',
      content: parts.map((text) => ({ type: 'input_text', text })),
    },
  ];
}
