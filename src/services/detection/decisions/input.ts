/**
 * The Decisions input: the decisions scan rendered as one text field per kind of fact.
 * The file tree, package names per manifest, lockfile names and `.env` key
 * names. Never file contents or `.env` values.
 */

import type { DecisionsScan } from './scan';

const MAX_ENTRIES_PER_DIR = 25;
const MAX_TREE_LINES = 500;
const MAX_MANIFESTS = 40;
const MAX_PACKAGES_PER_MANIFEST = 150;
const MAX_ENV_KEYS = 300;

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

/** The Decisions `state`: one text field per kind of fact. */
export type DecisionState = {
  file_tree: string;
  dependencies: string;
  lockfiles: string;
  env_key_names: string;
};

/** Render the scan as the Decisions `state`, one field per kind of fact. */
export function renderDecisionState(scan: DecisionsScan): DecisionState {
  const manifests = scan.manifests.slice(0, MAX_MANIFESTS);
  return {
    file_tree: renderFileTree(scan.files) || '(empty)',
    dependencies:
      manifests.length > 0
        ? manifests.map(renderManifest).join('\n')
        : '(no manifests found)',
    lockfiles: scan.lockfiles.length > 0 ? scan.lockfiles.join('\n') : '(none)',
    // Values are never read; only names reach this field.
    env_key_names: renderEnvKeys(scan),
  };
}

/** The state as readable text, one heading per field, for the dev script and tests. */
export function renderDecisionInput(scan: DecisionsScan): string {
  return Object.entries(renderDecisionState(scan))
    .map(([field, text]) => `## ${field}\n${text}`)
    .join('\n\n');
}

function renderManifest(manifest: DecisionsScan['manifests'][number]): string {
  const shown = manifest.packages.slice(0, MAX_PACKAGES_PER_MANIFEST);
  const more = manifest.packages.length - shown.length;
  const list = shown.length > 0 ? shown.join(', ') : '(no dependencies)';
  return `${manifest.path} (${manifest.ecosystem}): ${list}${
    more > 0 ? `, … +${more} more` : ''
  }`;
}

/** Key names grouped by the file that defines them. */
function renderEnvKeys(scan: DecisionsScan): string {
  const byFile = new Map<string, string[]>();
  for (const { name, files } of scan.envKeys.slice(0, MAX_ENV_KEYS)) {
    for (const file of files) {
      const names = byFile.get(file) ?? [];
      names.push(name);
      byFile.set(file, names);
    }
  }
  if (byFile.size === 0) return '(none)';
  return [...byFile.entries()]
    .map(([file, names]) => `${file}: ${names.join(', ')}`)
    .join('\n');
}
