/** Workspace markers: the files that make a directory a workspace root, and the member globs each names. */

import { minimatch } from 'minimatch';

/** What one marker file says about the workspace rooted at its directory. */
export type MarkerRead = {
  /** The tool the marker belongs to: `pnpm`, `npm`, `turbo`, `nx`, `lerna`, `cargo`, `go`, `gradle` or `uv`. */
  tool: string;
  /** Member globs relative to the marker's directory; a leading `!` excludes. */
  members: string[];
  /** The tool names no members itself: they come from another marker beside it, else every project below. */
  open?: true;
};

type MarkerParser = (content: string) => MarkerRead | null;

const quoted = (text: string): string[] =>
  [...text.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);

/** The body of the TOML table `[name]`, up to the next table. */
function tomlTable(content: string, name: string): string | null {
  const header = new RegExp(
    `^\\[${name.replace(/[.]/g, '\\.')}\\]\\s*(?:#.*)?$`,
    'm',
  );
  const match = header.exec(content);
  if (!match) return null;
  const rest = content.slice(match.index + match[0].length);
  const next = /^\[/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/** The strings of the TOML array `key = [...]` in a table body, across lines. */
function tomlArray(table: string, key: string): string[] {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]`, 'm').exec(
    table,
  );
  return match ? quoted(match[1]) : [];
}

function parsePnpmWorkspace(content: string): MarkerRead | null {
  const members: string[] = [];
  let inPackages = false;
  for (const raw of content.split('\n')) {
    if (/^\S/.test(raw)) inPackages = /^packages\s*:/.test(raw);
    if (!inPackages) continue;
    const item = /^\s*-\s*["']?([^"'#]+?)["']?\s*(?:#.*)?$/.exec(raw);
    if (item) members.push(item[1]);
  }
  return { tool: 'pnpm', members };
}

function parsePackageJsonWorkspaces(content: string): MarkerRead | null {
  let manifest: unknown;
  try {
    manifest = JSON.parse(content);
  } catch {
    return null;
  }
  const workspaces = (manifest as { workspaces?: unknown } | null)?.workspaces;
  const list = Array.isArray(workspaces)
    ? workspaces
    : (workspaces as { packages?: unknown } | undefined)?.packages;
  if (!Array.isArray(list)) return null;
  const members = list.filter((m): m is string => typeof m === 'string');
  return members.length > 0 ? { tool: 'npm', members } : null;
}

function parseLernaJson(content: string): MarkerRead | null {
  try {
    const packages = (JSON.parse(content) as { packages?: unknown }).packages;
    const members = Array.isArray(packages)
      ? packages.filter((m): m is string => typeof m === 'string')
      : ['packages/*'];
    return { tool: 'lerna', members };
  } catch {
    return null;
  }
}

function parseCargoWorkspace(content: string): MarkerRead | null {
  const table = tomlTable(content, 'workspace');
  if (table === null) return null;
  return {
    tool: 'cargo',
    members: [
      ...tomlArray(table, 'members'),
      ...tomlArray(table, 'exclude').map((m) => `!${m}`),
    ],
  };
}

function parseGoWork(content: string): MarkerRead | null {
  const members: string[] = [];
  let inBlock = false;
  for (const raw of content.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (inBlock) {
      if (line.startsWith(')')) inBlock = false;
      else if (line) members.push(line);
    } else if (/^use\s*\($/.test(line)) {
      inBlock = true;
    } else if (line.startsWith('use ')) {
      members.push(line.slice('use '.length).trim());
    }
  }
  return { tool: 'go', members };
}

function parseSettingsGradle(content: string): MarkerRead | null {
  const members: string[] = [];
  for (const line of content.split('\n')) {
    if (!/^\s*include\b/.test(line)) continue;
    for (const project of quoted(line)) {
      members.push(project.replace(/^:/, '').replaceAll(':', '/'));
    }
  }
  // A build with one module is one project, not a workspace.
  return members.length > 1 ? { tool: 'gradle', members } : null;
}

function parseUvWorkspace(content: string): MarkerRead | null {
  const table = tomlTable(content, 'tool.uv.workspace');
  if (table === null) return null;
  return {
    tool: 'uv',
    members: [
      ...tomlArray(table, 'members'),
      ...tomlArray(table, 'exclude').map((m) => `!${m}`),
    ],
  };
}

const open =
  (tool: string): MarkerParser =>
  () => ({ tool, members: [], open: true });

/** Every workspace marker the wizard reads, by file name. A map, so a file named `constructor` finds no parser. */
export const WORKSPACE_MARKERS: ReadonlyMap<string, MarkerParser> = new Map<
  string,
  MarkerParser
>([
  ['pnpm-workspace.yaml', parsePnpmWorkspace],
  ['package.json', parsePackageJsonWorkspaces],
  ['turbo.json', open('turbo')],
  ['nx.json', open('nx')],
  ['lerna.json', parseLernaJson],
  ['Cargo.toml', parseCargoWorkspace],
  ['go.work', parseGoWork],
  ['settings.gradle', parseSettingsGradle],
  ['settings.gradle.kts', parseSettingsGradle],
  ['pyproject.toml', parseUvWorkspace],
]);

/** The tool a workspace reports when several markers share its root: the build tool before the package manager. */
const TOOL_PRIORITY = [
  'turbo',
  'nx',
  'lerna',
  'pnpm',
  'npm',
  'cargo',
  'go',
  'gradle',
  'uv',
];

/** The markers of one directory as one workspace: its tool and its member globs. */
export function mergeMarkers(reads: readonly MarkerRead[]): MarkerRead | null {
  if (reads.length === 0) return null;
  const members = reads.flatMap((read) => read.members);
  const tool = [...reads].sort(
    (a, b) => TOOL_PRIORITY.indexOf(a.tool) - TOOL_PRIORITY.indexOf(b.tool),
  )[0].tool;
  return members.length > 0 ? { tool, members } : { tool, members, open: true };
}

const normalizeGlob = (glob: string): string =>
  glob.replace(/^\.\//, '').replace(/\/+$/, '');

/** Whether `dir`, relative to a workspace root, is one of the workspace's members. */
export function isWorkspaceMember(dir: string, workspace: MarkerRead): boolean {
  if (dir === '.' || dir === '') return false;
  if (workspace.open) return true;
  const included = workspace.members.filter((m) => !m.startsWith('!'));
  const excluded = workspace.members
    .filter((m) => m.startsWith('!'))
    .map((m) => m.slice(1));
  const matches = (globs: string[]) =>
    globs.some((glob) => minimatch(dir, normalizeGlob(glob), { dot: true }));
  return matches(included) && !matches(excluded);
}
