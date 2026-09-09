/**
 * Monorepo-aware sandbox write paths.
 *
 * The agent runs inside a Claude Agent SDK filesystem sandbox whose
 * `allowWrite` list only permits writes under the install dir (plus global
 * package-manager caches). In a monorepo the shared `node_modules` and the
 * lockfile live at the *workspace root* — an ancestor of the sub-package the
 * wizard was launched in — so a `pnpm/yarn/npm add` there is allowed by the
 * bash fence but the actual write is denied by the sandbox. The install then
 * fails silently and `package.json` is never updated.
 *
 * This module walks up from the install dir to find the workspace root and
 * returns the extra glob patterns the sandbox must allow so the package
 * manager can write where it wants. It knows nothing about PostHog — it is
 * generic monorepo machinery.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Manifests that mark a directory as a JS/TS workspace (monorepo) root. */
const PNPM_WORKSPACE_FILES = ['pnpm-workspace.yaml', 'pnpm-workspace.yml'];

/** Lockfiles a package manager rewrites at the workspace root on install. */
const ROOT_LOCKFILES = [
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'bun.lockb',
  'bun.lock',
];

/**
 * True when `dir` declares a JS/TS workspace: a `pnpm-workspace.yaml`, or a
 * `package.json` with a non-empty `workspaces` field (yarn / npm / bun).
 */
function declaresWorkspace(dir: string): boolean {
  if (PNPM_WORKSPACE_FILES.some((f) => fs.existsSync(path.join(dir, f)))) {
    return true;
  }
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
      workspaces?: unknown;
    };
    const ws = pkg.workspaces;
    if (Array.isArray(ws)) return ws.length > 0;
    if (
      ws &&
      typeof ws === 'object' &&
      Array.isArray((ws as { packages?: unknown }).packages)
    ) {
      return ((ws as { packages: unknown[] }).packages ?? []).length > 0;
    }
    return false;
  } catch {
    // A malformed package.json can't be trusted to declare a workspace.
    return false;
  }
}

/**
 * Nearest ancestor of `installDir` (excluding `installDir` itself) that
 * declares a JS/TS workspace, or `null` when the install dir is not nested in
 * a monorepo. The nearest declaring ancestor is where dependencies hoist to,
 * so it owns the shared `node_modules` and lockfile.
 */
export function findWorkspaceRoot(installDir: string): string | null {
  let dir = path.resolve(installDir);
  // Walk strictly upward — the install dir's own subtree is already writable.
  for (;;) {
    const parent = path.dirname(dir);
    if (parent === dir) return null; // reached the filesystem root
    dir = parent;
    if (declaresWorkspace(dir)) return dir;
  }
}

/**
 * Extra sandbox `allowWrite` glob patterns needed so an install run launched
 * inside a monorepo sub-package can write to the workspace root's shared
 * `node_modules` and lockfile. Returns `[]` when not in a monorepo.
 *
 * Paths use the SDK sandbox's leading-slash-on-absolute-path convention
 * (`'/' + absolutePath`), matching the entries in `agent-interface.ts`.
 */
export function workspaceRootWritePaths(installDir: string): string[] {
  const root = findWorkspaceRoot(installDir);
  if (!root) return [];
  const prefix = '/' + root;
  return [
    // Shared node_modules (pnpm's virtual `.pnpm` store lives here too).
    `${prefix}/node_modules`,
    `${prefix}/node_modules/**`,
    // Lockfiles the package manager rewrites on install.
    ...ROOT_LOCKFILES.map((f) => `${prefix}/${f}`),
  ];
}
