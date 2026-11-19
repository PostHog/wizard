/** Projects: the candidate projects a walk found, and the workspaces that hold them. Pure: it reads the walk. */

import path from 'path';
import type { Project } from '@programs/program-contract';
import { isWorkspaceMember, mergeMarkers, type MarkerRead } from './markers';
import { manifestDirs, type RepoFiles } from './walk';

/** A workspace root with members, and the tool that declares it. */
export type Workspace = {
  /** Root-relative path of the workspace root; `.` is the walked root. */
  root: string;
  tool: string;
  /** Root-relative paths of the member projects. */
  members: string[];
};

export type DiscoveredProjects = {
  /** `monorepo` when some workspace root has members. A repo fact, not a project trait. */
  repoType: 'monorepo' | 'single';
  /** The tool of the outermost workspace. */
  workspaceTool?: string;
  workspaces: Workspace[];
  /** Every project, shallowest first, with paths relative to the walked root. */
  projects: Project[];
  /** False when the walk hit a cap, so some projects may be missing. */
  complete: boolean;
};

const depthOf = (dir: string): number =>
  dir === '.' ? 0 : dir.split('/').length;

const byDepth = (a: string, b: string): number =>
  depthOf(a) - depthOf(b) || a.localeCompare(b);

/** `dir` as a path from `root`, or null when it is not below it. */
function below(root: string, dir: string): string | null {
  if (dir === root) return null;
  if (root === '.') return dir;
  return dir.startsWith(`${root}/`) ? dir.slice(root.length + 1) : null;
}

/** The workspace each marker directory declares. */
function workspacesByRoot(repo: RepoFiles): Map<string, MarkerRead> {
  const reads = new Map<string, MarkerRead[]>();
  for (const marker of repo.workspaceMarkers) {
    const root = path.posix.dirname(marker.path);
    reads.set(root, [...(reads.get(root) ?? []), marker]);
  }
  const workspaces = new Map<string, MarkerRead>();
  for (const [root, markers] of reads) {
    const merged = mergeMarkers(markers);
    if (merged) workspaces.set(root, merged);
  }
  return workspaces;
}

/**
 * The projects in a walked repo. Candidates are the directories that hold a
 * manifest; a workspace's member globs prune the candidates below it that it
 * does not name. The run project always stays.
 */
export function discoverProjects(
  repo: RepoFiles,
  runProject = '.',
): DiscoveredProjects {
  const candidates = manifestDirs(repo);
  const declared = workspacesByRoot(repo);

  const members = new Set<string>();
  const pruned = new Set<string>();
  const workspaces: Workspace[] = [];
  for (const [root, workspace] of [...declared].sort(([a], [b]) =>
    byDepth(a, b),
  )) {
    const own: string[] = [];
    for (const candidate of candidates) {
      const relative = below(root, candidate);
      if (relative === null) continue;
      if (isWorkspaceMember(relative, workspace)) own.push(candidate);
      else pruned.add(candidate);
    }
    own.forEach((member) => members.add(member));
    if (own.length > 0) {
      workspaces.push({ root, tool: workspace.tool, members: own });
    }
  }

  const kept = candidates.filter(
    (candidate) =>
      !pruned.has(candidate) ||
      members.has(candidate) ||
      declared.has(candidate),
  );
  const paths = [...new Set([...kept, runProject])].sort(byDepth);
  return {
    repoType: workspaces.length > 0 ? 'monorepo' : 'single',
    ...(workspaces.length > 0 && { workspaceTool: workspaces[0].tool }),
    workspaces,
    projects: paths.map((projectPath) => ({ path: projectPath, traits: {} })),
    complete: repo.complete && !repo.truncated,
  };
}

/** The project that contains `projectPath`: the one with the longest path above it, or undefined at the top. */
export function parentOf(
  projectPath: string,
  projects: readonly Project[],
): Project | undefined {
  return projects
    .filter((project) => below(project.path, projectPath) !== null)
    .sort((a, b) => depthOf(b.path) - depthOf(a.path))[0];
}
