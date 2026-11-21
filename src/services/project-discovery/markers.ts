/** Workspace markers: the files that make a directory a workspace root, and the member globs each names. */

import { Minimatch } from 'minimatch';
import { tomlArrayStrings } from './toml';

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

/** The body of the TOML table `[name]`, up to the next table. `header` matches the table's own line. */
function tomlTable(content: string, header: RegExp): string | null {
  const match = header.exec(content);
  if (!match) return null;
  const rest = content.slice(match.index + match[0].length);
  const next = /^\[/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

// Spaces and tabs only, never `\s`: a pattern that can cross lines is slow on a file of blank lines.
const WORKSPACE_TABLE = /^\[workspace\][ \t]*(?:#.*)?$/m;
const UV_WORKSPACE_TABLE = /^\[tool\.uv\.workspace\][ \t]*(?:#.*)?$/m;
const MEMBERS_ARRAY = /^[ \t]*members[ \t]*=[ \t]*\[/m;
const EXCLUDE_ARRAY = /^[ \t]*exclude[ \t]*=[ \t]*\[/m;

/** The strings of the TOML array `opening` starts in a table body, across lines. */
function tomlArray(table: string, opening: RegExp): string[] {
  const match = opening.exec(table);
  return match ? tomlArrayStrings(table, match.index + match[0].length) : [];
}

/** A YAML scalar as plain text: without its quotes or a trailing comment. */
function yamlScalar(text: string): string {
  const value = text.trim();
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, 1);
    return end === -1 ? value.slice(1) : value.slice(1, end);
  }
  const comment = value.search(/[ \t]#/);
  return (comment === -1 ? value : value.slice(0, comment)).trim();
}

/** The items of a YAML flow sequence body, such as `'apps/*', packages/*`. */
const flowItems = (body: string): string[] =>
  body.split(',').map(yamlScalar).filter(Boolean);

/**
 * The `packages` list of a `pnpm-workspace.yaml`, read line by line in linear
 * time. It reads a block list at any indent and a flow list (`[a, b]`), and
 * skips blank and comment lines. Not a YAML parser: only this one key.
 */
function parsePnpmWorkspace(content: string): MarkerRead | null {
  const members: string[] = [];
  let inPackages = false;
  // The text of a flow list that has not closed yet.
  let flow: string | null = null;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (flow !== null) {
      const close = line.indexOf(']');
      flow += ` ${close === -1 ? line : line.slice(0, close)}`;
      if (close === -1) continue;
      members.push(...flowItems(flow));
      flow = null;
      continue;
    }
    if (line === '' || line.startsWith('#')) continue;
    if (line === '-' || line.startsWith('- ')) {
      const item = yamlScalar(line.slice(1));
      if (inPackages && item) members.push(item);
      continue;
    }
    // Only a key at column zero opens or closes the list.
    if (raw[0] === ' ' || raw[0] === '\t') continue;
    const key = /^packages[ \t]*:(.*)$/.exec(line);
    inPackages = key !== null;
    const value = key?.[1].trim() ?? '';
    if (!value.startsWith('[')) continue;
    const close = value.indexOf(']');
    if (close === -1) flow = value.slice(1);
    else members.push(...flowItems(value.slice(1, close)));
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
  const table = tomlTable(content, WORKSPACE_TABLE);
  if (table === null) return null;
  return {
    tool: 'cargo',
    members: [
      ...tomlArray(table, MEMBERS_ARRAY),
      ...tomlArray(table, EXCLUDE_ARRAY).map((m) => `!${m}`),
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
  const table = tomlTable(content, UV_WORKSPACE_TABLE);
  if (table === null) return null;
  return {
    tool: 'uv',
    members: [
      ...tomlArray(table, MEMBERS_ARRAY),
      ...tomlArray(table, EXCLUDE_ARRAY).map((m) => `!${m}`),
    ],
  };
}

const open =
  (tool: string): MarkerParser =>
  () => ({ tool, members: [], open: true });

/** A `turbo.json` with `extends` configures one package of a workspace; only the root one is a marker. */
function parseTurboJson(content: string): MarkerRead | null {
  return /"extends"[ \t]*:/.test(content) ? null : open('turbo')(content);
}

/** Every workspace marker the wizard reads, by file name. A map, so a file named `constructor` finds no parser. */
export const WORKSPACE_MARKERS: ReadonlyMap<string, MarkerParser> = new Map<
  string,
  MarkerParser
>([
  ['pnpm-workspace.yaml', parsePnpmWorkspace],
  ['package.json', parsePackageJsonWorkspaces],
  ['turbo.json', parseTurboJson],
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

/** A workspace's member globs come from the repo, so only this many are read, each no longer than {@link MAX_GLOB_LENGTH}. */
const MAX_MEMBER_GLOBS = 200;
const MAX_GLOB_LENGTH = 256;

/** A glob the wizard matches: short enough, and with no `..` segment, which would leave the workspace root. */
const isUsableGlob = (glob: string): boolean =>
  glob.length > 0 &&
  glob.length <= MAX_GLOB_LENGTH &&
  !glob.split('/').includes('..');

type MemberMatchers = { included: Minimatch[]; excluded: Minimatch[] };

/** Each workspace's globs, compiled once. */
const MATCHERS = new WeakMap<MarkerRead, MemberMatchers>();

function matchersOf(workspace: MarkerRead): MemberMatchers {
  const known = MATCHERS.get(workspace);
  if (known) return known;
  const matchers: MemberMatchers = { included: [], excluded: [] };
  for (const member of workspace.members.slice(0, MAX_MEMBER_GLOBS)) {
    const excludes = member.startsWith('!');
    const glob = normalizeGlob(excludes ? member.slice(1) : member);
    if (!isUsableGlob(glob)) continue;
    (excludes ? matchers.excluded : matchers.included).push(
      new Minimatch(glob, { dot: true }),
    );
  }
  MATCHERS.set(workspace, matchers);
  return matchers;
}

/** Whether `dir`, relative to a workspace root, is one of the workspace's members. */
export function isWorkspaceMember(dir: string, workspace: MarkerRead): boolean {
  if (dir === '.' || dir === '') return false;
  if (workspace.open) return true;
  const { included, excluded } = matchersOf(workspace);
  const matches = (globs: Minimatch[]) => globs.some((glob) => glob.match(dir));
  return matches(included) && !matches(excluded);
}
