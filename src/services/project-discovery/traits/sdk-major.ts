/** Declared PostHog SDK major detection across supported ecosystems; best-effort and never throws. */

import fs from 'fs';
import path from 'path';
import { MAX_DIR_ENTRIES, readProjectFile } from '@utils/bounded-fs';
import {
  getDeclaredVersion,
  getInstalledPackageVersion,
  parsePackageJson,
} from '@utils/package-json';
import type { PostHogSdk } from '@shared/sdk-features';
import { rangeFloor, rangeMajor } from '@utils/semver';
import { tomlArrayStrings } from '../toml';

export type { PostHogSdk };

/** A declared SDK's major and, when it is known, its installed version. */
export type DeclaredSdk = { major: string; version?: string };

type Declared = { range: string; resolved: () => string | undefined };

function isWithinRoot(realPath: string, realRoot: string): boolean {
  return realRoot === path.sep
    ? realPath.startsWith(path.sep)
    : realPath.startsWith(`${realRoot}${path.sep}`);
}

function resolveRealRoots(dirs: readonly string[]): string[] {
  const roots: string[] = [];
  for (const dir of dirs) {
    try {
      const st = fs.statSync(dir);
      if (!st.isDirectory()) continue;
      const real = fs.realpathSync(dir);
      if (!roots.includes(real)) roots.push(real);
    } catch {
      // Skip missing or inaccessible roots.
    }
  }
  return roots;
}

function resolveScopedFile(
  filePath: string,
  realRoots: readonly string[],
): string | null {
  if (realRoots.length === 0) return null;
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    const real = fs.realpathSync(filePath);
    return realRoots.some((root) => isWithinRoot(real, root)) ? real : null;
  } catch {
    return null;
  }
}

function readScopedFile(
  filePath: string,
  realRoots: readonly string[],
): string | null {
  const real = resolveScopedFile(filePath, realRoots);
  return real ? readProjectFile(real) : null;
}

function searchDirs(dir: string, workspaceDir?: string): string[] {
  const resolved = path.resolve(dir);
  if (!workspaceDir) return [resolved];
  const ws = path.resolve(workspaceDir);
  return ws === resolved ? [resolved] : [resolved, ws];
}

function readFirst(
  dirs: readonly string[],
  realRoots: readonly string[],
  relPaths: readonly string[],
): string | null {
  for (const dir of dirs) {
    for (const rel of relPaths) {
      const content = readScopedFile(path.join(dir, rel), realRoots);
      if (content !== null) return content;
    }
  }
  return null;
}

/** Resolved version of `name` inside a TOML lockfile (`uv.lock`, `poetry.lock`, `Cargo.lock`). */
function lockedTomlVersion(
  dirs: readonly string[],
  realRoots: readonly string[],
  lockfiles: readonly string[],
  name: string,
): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pair = new RegExp(
    `^name\\s*=\\s*"${escaped}"\\r?\\nversion\\s*=\\s*"([^"]+)"`,
    'm',
  );
  for (const dir of dirs) {
    for (const file of lockfiles) {
      const content = readScopedFile(path.join(dir, file), realRoots);
      if (!content) continue;
      const direct = pair.exec(content)?.[1];
      if (direct) return direct;
      for (const block of content.split('[[package]]').slice(1)) {
        const end = block.indexOf('\n[');
        const body = end === -1 ? block : block.slice(0, end);
        if (!new RegExp(`^name\\s*=\\s*"${escaped}"`, 'm').test(body)) continue;
        const ver = /^version\s*=\s*"([^"]+)"/m.exec(body)?.[1];
        if (ver) return ver;
      }
    }
  }
  return undefined;
}

/** PEP 440 specifier list -> semver range string. */
const pythonRange = (spec: string): string =>
  spec
    .split(',')
    .map((c) => c.replace(/\s+/g, ''))
    .filter((c) => c && !c.startsWith('!='))
    .map((c) => c.replace(/^={2,3}/, '').replace(/^~=/, '^'))
    .join(' ');

function findPep621PosthogSpec(pyproject: string): string | undefined {
  const projectHeader = /^\[project\][ \t]*(?:#.*)?$/m.exec(pyproject);
  if (!projectHeader) return undefined;
  const startOffset = projectHeader.index + projectHeader[0].length;
  const nextTable = pyproject.slice(startOffset).search(/\r?\n\[/);
  const section =
    nextTable === -1
      ? pyproject.slice(startOffset)
      : pyproject.slice(startOffset, startOffset + nextTable);
  const deps = /^[ \t]*dependencies[ \t]*=[ \t]*\[/m.exec(section);
  if (!deps) return undefined;
  for (const dep of tomlArrayStrings(section, deps.index + deps[0].length)) {
    const cleaned = dep.split(';')[0]?.trim() ?? '';
    const m = /^posthog(?![\w.-])(?:\[[^\]]*\])?[ \t]*(.*)$/i.exec(cleaned);
    if (m) return m[1];
  }
  return undefined;
}

function declaredPython(
  dir: string,
  dirs: readonly string[],
  realRoots: readonly string[],
): Declared | undefined {
  let requirementsUnpinned = false;
  const requirements = readScopedFile(
    path.join(dir, 'requirements.txt'),
    realRoots,
  );
  if (requirements !== null) {
    const normalized = requirements.replace(/\\\r?\n[ \t]*/g, ' ');
    for (const rawLine of normalized.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*$/, '').trim();
      if (!line || line.startsWith('-')) continue;
      const m = /^posthog(?![\w.-])(?:\[[^\]]*\])?[ \t]*([^;]*)/i.exec(line);
      if (!m) continue;
      const rawSpec = m[1];
      const optIdx = rawSpec.search(/[ \t]--?[A-Za-z]/);
      const spec = (optIdx === -1 ? rawSpec : rawSpec.slice(0, optIdx)).trim();
      const range = pythonRange(spec);
      if (rangeMajor(range) !== undefined) {
        return {
          range,
          resolved: () => lockedPythonVersion(dirs, realRoots),
        };
      }
      requirementsUnpinned = true;
      break;
    }
  }

  const pyproject = readScopedFile(path.join(dir, 'pyproject.toml'), realRoots);
  if (pyproject !== null) {
    const pep621 =
      findPep621PosthogSpec(pyproject) ??
      extractTomlSectionSpec(
        pyproject,
        /^\[tool\.poetry(?:\.group\.[^.\]]+)?\.dependencies\]/m,
        'posthog',
      );
    if (pep621 !== undefined) {
      const range = pythonRange(pep621);
      if (!requirementsUnpinned || rangeMajor(range) !== undefined) {
        return {
          range,
          resolved: () => lockedPythonVersion(dirs, realRoots),
        };
      }
    }
  }

  const pipfile = readScopedFile(path.join(dir, 'Pipfile'), realRoots);
  if (pipfile !== null) {
    const spec = extractTomlSectionSpec(pipfile, /^\[packages\]/m, 'posthog');
    if (spec !== undefined) {
      const range = pythonRange(spec);
      if (!requirementsUnpinned || rangeMajor(range) !== undefined) {
        return {
          range,
          resolved: () => lockedPythonVersion(dirs, realRoots),
        };
      }
    }
  }

  if (requirementsUnpinned) {
    return {
      range: '',
      resolved: () => lockedPythonVersion(dirs, realRoots),
    };
  }

  return undefined;
}

function lockedPythonVersion(
  dirs: readonly string[],
  realRoots: readonly string[],
): string | undefined {
  const tomlVer = lockedTomlVersion(
    dirs,
    realRoots,
    ['uv.lock', 'poetry.lock'],
    'posthog',
  );
  if (tomlVer) return tomlVer;
  const pipfileLock = readFirst(dirs, realRoots, ['Pipfile.lock']);
  if (!pipfileLock) return undefined;
  try {
    const parsed = JSON.parse(pipfileLock) as {
      default?: { posthog?: { version?: string } };
    };
    return parsed.default?.posthog?.version?.replace(/^={2,3}/, '');
  } catch {
    return undefined;
  }
}

/** Read inline `"..."` or `{ version = "..." }` for `pkg` inside matching TOML sections. */
function extractTomlSectionSpec(
  content: string,
  sectionHeader: RegExp,
  pkgPattern: string,
): string | undefined {
  let active = false;
  const lineRe = new RegExp(
    `^\\s*(?:${pkgPattern})\\s*=\\s*(?:"([^"]*)"|\\{([^}]*)\\})`,
  );
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    if (line.startsWith('[')) {
      active = sectionHeader.test(line);
      continue;
    }
    if (!active) continue;
    const match = lineRe.exec(line);
    if (!match) continue;
    if (match[1] !== undefined) return match[1];
    const table = match[2] ?? '';
    const ver = /\bversion\s*=\s*"([^"]*)"/.exec(table)?.[1];
    if (ver !== undefined) return ver;
    if (/\bworkspace\s*=\s*true\b/.test(table)) return '*';
  }
  return undefined;
}

function declaredNode(
  dir: string,
  dirs: readonly string[],
  realRoots: readonly string[],
): Declared | undefined {
  const raw = readScopedFile(path.join(dir, 'package.json'), realRoots);
  const pkg = raw !== null ? parsePackageJson(raw) : null;
  if (!pkg) return undefined;
  const range = getDeclaredVersion('posthog-node', pkg);
  if (range === undefined) return undefined;
  return {
    range,
    resolved: () => {
      for (const candidate of dirs) {
        const installed = getInstalledPackageVersion('posthog-node', candidate);
        if (installed) return installed;
      }
      const lock = readFirst(dirs, realRoots, ['package-lock.json']);
      if (!lock) return undefined;
      try {
        const parsed = JSON.parse(lock) as {
          packages?: Record<string, { version?: string }>;
          dependencies?: Record<string, { version?: string }>;
        };
        return (
          parsed.packages?.['node_modules/posthog-node']?.version ??
          parsed.dependencies?.['posthog-node']?.version
        );
      } catch {
        return undefined;
      }
    },
  };
}

function declaredGo(
  dir: string,
  realRoots: readonly string[],
): Declared | undefined {
  const goMod = readScopedFile(path.join(dir, 'go.mod'), realRoots);
  if (!goMod) return undefined;
  let inRequire = false;
  for (const rawLine of goMod.split(/\r?\n/)) {
    const isIndirect = /\s\/\/\s*indirect\b/.test(rawLine);
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    if (/^require\s*\($/.test(line)) {
      inRequire = true;
      continue;
    }
    if (inRequire && line === ')') {
      inRequire = false;
      continue;
    }
    const spec = inRequire ? line : /^require\s+(.+)$/.exec(line)?.[1];
    if (!spec || isIndirect) continue;
    const version =
      /^github\.com\/posthog\/posthog-go(?:\/v\d+)?\s+v(\d+\.\d+\.\d+)/.exec(
        spec,
      )?.[1];
    if (version) return { range: version, resolved: () => undefined };
  }
  return undefined;
}

function declaredRust(
  dir: string,
  dirs: readonly string[],
  realRoots: readonly string[],
): Declared | undefined {
  const cargo = readScopedFile(path.join(dir, 'Cargo.toml'), realRoots);
  if (!cargo) return undefined;

  let crateName: string | undefined;
  let spec: string | undefined;
  for (const candidate of ['posthog-rs', 'posthog']) {
    const inTable = extractTomlSectionSpec(
      cargo,
      /^\[(?:workspace\.dependencies|(?:target\.[^.\]]+\.)?(?:dependencies|dev-dependencies|build-dependencies))\]$/,
      candidate,
    );
    if (inTable !== undefined) {
      crateName = candidate;
      spec = inTable;
      break;
    }
    const dotSection = new RegExp(
      `^\\[(?:dependencies|dev-dependencies|build-dependencies)\\.${candidate}\\]\\r?\\n([\\s\\S]*?)(?=\\n\\[|$)`,
      'm',
    ).exec(cargo)?.[1];
    if (dotSection) {
      const ver = /^[ \t]*version[ \t]*=[ \t]*"([^"]*)"/m.exec(dotSection)?.[1];
      if (ver !== undefined) {
        crateName = candidate;
        spec = ver;
        break;
      }
      if (/^[ \t]*workspace[ \t]*=[ \t]*true/m.test(dotSection)) {
        crateName = candidate;
        spec = '*';
        break;
      }
    }
  }
  if (!crateName || spec === undefined) return undefined;

  // Inherited workspace dependencies declare their version in workspace root Cargo.toml (including root-package workspaces).
  if (spec === '*') {
    for (const rootDir of dirs) {
      const rootCargo = readScopedFile(
        path.join(rootDir, 'Cargo.toml'),
        realRoots,
      );
      const wsSpec = rootCargo
        ? extractTomlSectionSpec(
            rootCargo,
            /^\[workspace\.dependencies\]$/,
            crateName,
          )
        : undefined;
      if (wsSpec !== undefined && wsSpec !== '*') {
        spec = wsSpec;
        break;
      }
    }
  }

  return {
    range: spec.replaceAll(',', ' '),
    resolved: () =>
      lockedTomlVersion(dirs, realRoots, ['Cargo.lock'], crateName),
  };
}

/** Convert CocoaPods pessimistic constraints (`~> 3.0`, `'3.92.0'`) into semver ranges. */
function cocoapodsRange(spec: string): string {
  const clauses = spec
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const tildeArrow = /^~>\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(c);
      if (!tildeArrow) return c;
      const major = Number(tildeArrow[1]);
      if (tildeArrow[3] !== undefined) {
        return `~${major}.${tildeArrow[2]}.${tildeArrow[3]}`;
      }
      const minor = Number(tildeArrow[2] ?? '0');
      return `>=${major}.${minor}.0 <${major + 1}.0.0-0`;
    });
  return clauses.join(' ');
}

const MAX_XCODEPROJ_BUNDLES = 8;

function xcodeProjDirs(dir: string): string[] {
  let opened: fs.Dir | undefined;
  try {
    const dirStat = fs.statSync(dir);
    if (!dirStat.isDirectory()) return [];
    opened = fs.opendirSync(dir);
    const found: string[] = [];
    for (let i = 0; i < MAX_DIR_ENTRIES; i++) {
      const entry = opened.readSync();
      if (!entry) break;
      if (
        !entry.isSymbolicLink() &&
        entry.isDirectory() &&
        entry.name.endsWith('.xcodeproj')
      ) {
        found.push(entry.name);
        if (found.length >= MAX_XCODEPROJ_BUNDLES) break;
      }
    }
    return found.sort();
  } catch {
    return [];
  } finally {
    try {
      opened?.closeSync();
    } catch {
      // Ignore close error on best-effort directory scan.
    }
  }
}

function lockedIosSwiftPmVersion(
  dir: string,
  dirs: readonly string[],
  realRoots: readonly string[],
): string | undefined {
  const candidates = [
    'Package.resolved',
    ...xcodeProjDirs(dir).map((name) =>
      path.join(
        name,
        'project.xcworkspace',
        'xcshareddata',
        'swiftpm',
        'Package.resolved',
      ),
    ),
  ];
  const raw = readFirst(dirs, realRoots, candidates);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as {
      pins?: Array<{
        identity?: string;
        location?: string;
        state?: { version?: string };
      }>;
    };
    const pin = parsed.pins?.find(
      (p) =>
        p.identity?.toLowerCase() === 'posthog-ios' ||
        /posthog-ios(?:\.git)?$/i.test(p.location ?? ''),
    );
    return pin?.state?.version;
  } catch {
    return undefined;
  }
}

function scanBalanced(
  text: string,
  openIdx: number,
  openCh: string,
  closeCh: string,
): number {
  let depth = 0;
  let inQuote = false;
  let escaped = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inQuote = false;
      }
      continue;
    }
    if (ch === '"') {
      inQuote = true;
    } else if (ch === openCh) {
      depth++;
    } else if (ch === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Strip Swift `//` and nested `/* ... *\/` comments while keeping string literals intact. */
function stripSwiftComments(text: string): string {
  const out: string[] = [];
  let inQuote = false;
  let escaped = false;
  let blockDepth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (blockDepth > 0) {
      if (ch === '/' && next === '*') {
        blockDepth++;
        i += 2;
      } else if (ch === '*' && next === '/') {
        blockDepth--;
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    if (inQuote) {
      out.push(ch);
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inQuote = false;
      }
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      const nl = text.indexOf('\n', i + 2);
      if (nl === -1) break;
      out.push('\n');
      i = nl + 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockDepth = 1;
      out.push(' ');
      i += 2;
      continue;
    }
    if (ch === '"') inQuote = true;
    out.push(ch);
    i++;
  }
  return out.join('');
}

function extractSwiftPackageBlock(pkgSwift: string): string | undefined {
  const cleaned = stripSwiftComments(pkgSwift);
  let searchFrom = 0;
  while (searchFrom < cleaned.length) {
    const idx = cleaned.indexOf('.package(', searchFrom);
    if (idx === -1) return undefined;
    const openParen = idx + '.package'.length;
    const closeParen = scanBalanced(cleaned, openParen, '(', ')');
    if (closeParen === -1) return undefined;
    const block = cleaned.slice(idx, closeParen + 1);
    if (/posthog-ios/i.test(block)) return block;
    searchFrom = closeParen + 1;
  }
  return undefined;
}

/** Find the innermost enclosing `{` strictly within `[floor, limit)` in O(limit - floor). */
function findEnclosingOpenBrace(
  text: string,
  floor: number,
  limit: number,
): number {
  const stack: number[] = [];
  let inQuote = false;
  let escaped = false;
  for (let i = floor; i < limit; i++) {
    const ch = text[i];
    if (inQuote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inQuote = false;
      }
      continue;
    }
    if (ch === '"') {
      inQuote = true;
    } else if (ch === '{') {
      stack.push(i);
    } else if (ch === '}' && stack.length > 0) {
      stack.pop();
    }
  }
  return stack.length > 0 ? stack[stack.length - 1] : -1;
}

function sectionHasPosthogRepoUrl(section: string): boolean {
  for (const stmt of section.split(';')) {
    if (
      /^[ \t\r\n]*repositoryURL[ \t]*=/i.test(stmt) &&
      /posthog-ios/i.test(stmt)
    ) {
      return true;
    }
  }
  return false;
}

function extractPbxRemoteRef(pbxproj: string): string | undefined {
  const markerRe =
    /XCRemoteSwiftPackageReference(?:[ \t]+"posthog-ios"[ \t]*\*\/[ \t]*=[ \t]*\{|[ \t]*;)/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = markerRe.exec(pbxproj)) !== null) {
    const blockStart = match[0].endsWith('{')
      ? match.index + match[0].length - 1
      : findEnclosingOpenBrace(pbxproj, cursor, match.index);
    if (blockStart === -1) {
      cursor = Math.max(cursor, match.index + match[0].length);
      continue;
    }
    const blockEnd = scanBalanced(pbxproj, blockStart, '{', '}');
    if (blockEnd === -1) return undefined;
    cursor = Math.max(cursor, blockEnd + 1, match.index + match[0].length);
    markerRe.lastIndex = cursor;
    if (blockEnd < match.index) continue;
    const section = pbxproj.slice(blockStart, blockEnd + 1);
    if (sectionHasPosthogRepoUrl(section)) {
      const req = /\brequirement[ \t]*=[ \t]*\{([^}]*)\}/i.exec(section);
      if (req) return req[1];
    }
  }
  return undefined;
}

function declaredIos(
  dir: string,
  dirs: readonly string[],
  realRoots: readonly string[],
): Declared | undefined {
  const podfile = readScopedFile(path.join(dir, 'Podfile'), realRoots);
  if (podfile !== null) {
    const pod =
      /^[ \t]*pod[ \t]+['"]PostHog(?:\/[^'"]*)?['"](?:[ \t]*,[ \t]*['"]([^'"]+)['"])?/m.exec(
        podfile,
      );
    if (pod) {
      if (pod[1]) {
        return {
          range: cocoapodsRange(pod[1]),
          resolved: () => lockedIosCocoaPodVersion(dirs, realRoots),
        };
      }
      // posthog-ios 4.x dropped CocoaPods support, so an unpinned Podfile resolves 3.x.
      return {
        range: lockedIosCocoaPodVersion(dirs, realRoots) ?? '3.0.0',
        resolved: () => undefined,
      };
    }
  }

  const pkgSwift = readScopedFile(path.join(dir, 'Package.swift'), realRoots);
  if (pkgSwift !== null) {
    const pkgBlock = extractSwiftPackageBlock(pkgSwift);
    if (pkgBlock) {
      const halfOpen = /"([^"]+)"\s*\.\.<\s*"([^"]+)"/.exec(pkgBlock);
      const closed = /"([^"]+)"\s*\.\.\.\s*"([^"]+)"/.exec(pkgBlock);
      const ver =
        /(?:\bfrom\s*:\s*|\bexact\s*:\s*|\.upToNextMajor\s*\(\s*from\s*:\s*|\.upToNextMinor\s*\(\s*from\s*:\s*|\.exact\s*\(\s*)"([^"]+)"/.exec(
          pkgBlock,
        )?.[1] ??
        (halfOpen
          ? `>=${halfOpen[1]} <${halfOpen[2]}-0`
          : closed
          ? `>=${closed[1]} <=${closed[2]}`
          : '');
      return {
        range: ver,
        resolved: () => lockedIosSwiftPmVersion(dir, dirs, realRoots),
      };
    }
  }

  const projectYml = readScopedFile(path.join(dir, 'project.yml'), realRoots);
  if (projectYml !== null) {
    const ymlBlock =
      /^[ \t]*PostHog:[ \t]*(?:\r?\n[ \t]+\S[^\r\n]*)*/m.exec(
        projectYml,
      )?.[0] ??
      /^[ \t]*\w+:[ \t]*\r?\n[ \t]+url:[ \t]*https:\/\/github\.com\/PostHog\/posthog-ios[^\r\n]*(?:\r?\n[ \t]+\S[^\r\n]*)*/im.exec(
        projectYml,
      )?.[0];
    if (ymlBlock && /posthog-ios/i.test(ymlBlock)) {
      const ver =
        /^[ \t]*(?:from|exactVersion|version|majorVersion)[ \t]*:[ \t]*['"]?([0-9][^'"\s#]*)/m.exec(
          ymlBlock,
        )?.[1] ?? '';
      return {
        range: ver,
        resolved: () => lockedIosSwiftPmVersion(dir, dirs, realRoots),
      };
    }
  }

  for (const projDir of xcodeProjDirs(dir)) {
    const pbxproj = readScopedFile(
      path.join(dir, projDir, 'project.pbxproj'),
      realRoots,
    );
    if (!pbxproj) continue;
    const remoteRef = extractPbxRemoteRef(pbxproj);
    if (remoteRef) {
      const kind = /\bkind\s*=\s*([^;\s]+)/.exec(remoteRef)?.[1];
      const ver = /\b(?:minimumVersion|version)\s*=\s*([0-9][^;\s]*)/.exec(
        remoteRef,
      )?.[1];
      const range =
        kind === 'upToNextMajorVersion' ||
        kind === 'upToNextMinorVersion' ||
        kind === 'exactVersion'
          ? ver ?? ''
          : '';
      return {
        range,
        resolved: () => lockedIosSwiftPmVersion(dir, dirs, realRoots),
      };
    }
  }

  return undefined;
}

function lockedIosCocoaPodVersion(
  dirs: readonly string[],
  realRoots: readonly string[],
): string | undefined {
  const raw = readFirst(dirs, realRoots, ['Podfile.lock']);
  if (!raw) return undefined;
  return /^[ \t]*-[ \t]+PostHog(?:[ \t]+|\/[^(\r\n]*[ \t]*)\((?:=[ \t]*)?([0-9][^)\r\n\t ]*)\)/m.exec(
    raw,
  )?.[1];
}

const normalizeGradleVersion = (raw: string): string => {
  const cleaned = raw.trim().replace(/^v/, '');
  return cleaned.endsWith('.+') ? `${cleaned.slice(0, -1)}x` : cleaned;
};

type CatalogLibrary = {
  alias: string;
  artifactId: string;
  version: string;
  bundles: string[];
};

/** Walk-scoped cache of parsed Gradle version catalogs, keyed by canonical file path. */
export type GradleCatalogCache = Map<string, CatalogLibrary[] | null>;

type RawCatalogLibrary = {
  alias: string;
  artifactId: string;
  directVer?: string;
  refKey?: string;
};

function parseCatalogLibraries(content: string): CatalogLibrary[] {
  const versions = new Map<string, string>();
  const rawLibs: RawCatalogLibrary[] = [];
  const bundleMembers = new Map<string, string[]>();
  const lines = content.split(/\r?\n/);
  let section = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/#.*$/, '').trim();
    if (!line) continue;
    if (line.startsWith('[')) {
      section = line;
      continue;
    }
    if (section === '[versions]') {
      const m = /^([A-Za-z0-9_.-]+)[ \t]*=[ \t]*["']([^"']*)["']/.exec(line);
      if (m) versions.set(m[1], m[2]);
      continue;
    }
    if (section === '[libraries]') {
      const kv = /^([A-Za-z0-9_.-]+)[ \t]*=[ \t]*(.+)$/.exec(line);
      if (!kv) continue;
      const [, alias, rhs] = kv;
      const coord =
        /com\.posthog:(posthog-android|posthog-kmp):([0-9][^"']*)/.exec(rhs);
      if (coord) {
        rawLibs.push({
          alias,
          artifactId: coord[1],
          directVer: coord[2],
        });
        continue;
      }
      const mod =
        /\bmodule[ \t]*=[ \t]*["']com\.posthog:(posthog-android|posthog-kmp)["']/.exec(
          rhs,
        )?.[1];
      const groupMatch = /\bgroup[ \t]*=[ \t]*["']com\.posthog["']/.test(rhs)
        ? /\bname[ \t]*=[ \t]*["'](posthog-android|posthog-kmp)["']/.exec(
            rhs,
          )?.[1]
        : undefined;
      const artifactId = mod ?? groupMatch;
      if (!artifactId) continue;
      const directVer = /\bversion[ \t]*=[ \t]*["']([^"']*)["']/.exec(rhs)?.[1];
      const refKey = /\bversion\.ref[ \t]*=[ \t]*["']([^"']*)["']/.exec(
        rhs,
      )?.[1];
      rawLibs.push({ alias, artifactId, directVer, refKey });
      continue;
    }
    if (section === '[bundles]') {
      const kv = /^([A-Za-z0-9_.-]+)[ \t]*=[ \t]*\[(.*)$/.exec(line);
      if (!kv) continue;
      const [, bundleAlias, firstRest] = kv;
      let buf = firstRest;
      while (!buf.includes(']') && i + 1 < lines.length) {
        i++;
        buf += `\n${lines[i].replace(/#.*$/, '')}`;
      }
      bundleMembers.set(bundleAlias, tomlArrayStrings(buf, 0));
    }
  }

  const bundlesByLib = new Map<string, string[]>();
  for (const [bundleAlias, members] of bundleMembers) {
    for (const member of members) {
      const list = bundlesByLib.get(member);
      if (list) {
        list.push(bundleAlias);
      } else {
        bundlesByLib.set(member, [bundleAlias]);
      }
    }
  }

  const entries: CatalogLibrary[] = [];
  for (const lib of rawLibs) {
    const resolved =
      lib.directVer ?? (lib.refKey ? versions.get(lib.refKey) : undefined);
    if (!resolved) continue;
    entries.push({
      alias: lib.alias,
      artifactId: lib.artifactId,
      version: normalizeGradleVersion(resolved),
      bundles: bundlesByLib.get(lib.alias) ?? [],
    });
  }
  return entries;
}

function readCatalogLibraries(
  dirs: readonly string[],
  realRoots: readonly string[],
  catalogCache?: GradleCatalogCache,
): CatalogLibrary[] | undefined {
  for (const dir of dirs) {
    for (const rel of ['gradle/libs.versions.toml', 'libs.versions.toml']) {
      const real = resolveScopedFile(path.join(dir, rel), realRoots);
      if (!real) continue;
      if (catalogCache?.has(real)) {
        const cached = catalogCache.get(real);
        if (cached) return cached;
        continue;
      }
      const content = readProjectFile(real);
      if (!content) {
        catalogCache?.set(real, null);
        continue;
      }
      const parsed = parseCatalogLibraries(content);
      catalogCache?.set(real, parsed);
      return parsed;
    }
  }
  return undefined;
}

type GradleScriptRefs = {
  accessors: Set<string>;
  findLibraries: Set<string>;
  findBundles: Set<string>;
  mentionsArtifact: boolean;
};

/** Extract all `libs.*`, `findLibrary(...)`, and `findBundle(...)` references in one linear pass. */
function collectGradleScriptRefs(
  scripts: readonly string[],
  artifactId: string,
): GradleScriptRefs {
  const accessors = new Set<string>();
  const findLibraries = new Set<string>();
  const findBundles = new Set<string>();
  let mentionsArtifact = false;
  const fullCoord = `com.posthog:${artifactId}`;
  for (const s of scripts) {
    if (s.includes(fullCoord)) mentionsArtifact = true;
    for (const m of s.matchAll(/(?:^|[^A-Za-z0-9_])libs\.([A-Za-z0-9_.]+)/g)) {
      const raw = m[1].replace(/\.(?:get|asProvider)$/, '');
      accessors.add(raw);
    }
    for (const m of s.matchAll(/\bfindLibrary\([ \t]*["']([^"']+)["']/g)) {
      findLibraries.add(m[1]);
    }
    for (const m of s.matchAll(/\bfindBundle\([ \t]*["']([^"']+)["']/g)) {
      findBundles.add(m[1]);
    }
  }
  return { accessors, findLibraries, findBundles, mentionsArtifact };
}

function toGradleAccessor(alias: string): string {
  return alias.replace(/[-_]+/g, '.');
}

function scriptRefsMatchEntry(
  refs: GradleScriptRefs,
  entry: CatalogLibrary,
): boolean {
  if (refs.mentionsArtifact) return true;
  if (
    refs.accessors.has(toGradleAccessor(entry.alias)) ||
    refs.findLibraries.has(entry.alias)
  ) {
    return true;
  }
  for (const bundle of entry.bundles) {
    if (
      refs.accessors.has(`bundles.${toGradleAccessor(bundle)}`) ||
      refs.findBundles.has(bundle)
    ) {
      return true;
    }
  }
  return false;
}

/** Parse `com.posthog:<artifactId>` version from Gradle build scripts or version catalogs. */
function declaredGradle(
  dir: string,
  dirs: readonly string[],
  realRoots: readonly string[],
  artifactId: string,
  gradleFiles: readonly string[],
  catalogCache?: GradleCatalogCache,
): Declared | undefined {
  const directRe = new RegExp(`com\\.posthog:${artifactId}:([0-9][^'"\\s)]*)`);
  const scripts: string[] = [];
  for (const file of gradleFiles) {
    const content = readScopedFile(path.join(dir, file), realRoots);
    if (!content) continue;
    scripts.push(content);
    const m = directRe.exec(content);
    if (m) {
      return {
        range: normalizeGradleVersion(m[1]),
        resolved: () => undefined,
      };
    }
  }

  if (scripts.length === 0) return undefined;
  const refs = collectGradleScriptRefs(scripts, artifactId);
  if (
    !refs.mentionsArtifact &&
    refs.accessors.size === 0 &&
    refs.findLibraries.size === 0 &&
    refs.findBundles.size === 0
  ) {
    return undefined;
  }

  const catalog = readCatalogLibraries(dirs, realRoots, catalogCache);
  if (!catalog) return undefined;

  for (const entry of catalog) {
    if (entry.artifactId !== artifactId) continue;
    if (scriptRefsMatchEntry(refs, entry)) {
      return {
        range: entry.version,
        resolved: () => undefined,
      };
    }
  }

  return undefined;
}

function declaredFlutter(
  dir: string,
  dirs: readonly string[],
  realRoots: readonly string[],
): Declared | undefined {
  const pubspec = readScopedFile(path.join(dir, 'pubspec.yaml'), realRoots);
  if (!pubspec) return undefined;
  const match =
    /^[ \t]*posthog_flutter[ \t]*:[ \t]*(?:['"]([^'"]*)['"]|([^\s#'"{][^#\r\n]*))?/m.exec(
      pubspec,
    );
  if (!match) return undefined;
  const spec = (match[1] ?? match[2] ?? '').trim();
  const range = !spec || spec === 'any' || spec.startsWith('sdk:') ? '' : spec;
  return {
    range,
    resolved: () => {
      const lock = readFirst(dirs, realRoots, ['pubspec.lock']);
      if (!lock) return undefined;
      return /^[ \t]{2}posthog_flutter:\r?\n(?:[ \t]{4}[^\r\n]+\r?\n)*?[ \t]{4}version:[ \t]*["']?([^"'\r\n]+)/m.exec(
        lock,
      )?.[1];
    },
  };
}

const DETECTORS: Record<
  PostHogSdk,
  (
    dir: string,
    dirs: readonly string[],
    realRoots: readonly string[],
    catalogCache?: GradleCatalogCache,
  ) => Declared | undefined
> = {
  python: declaredPython,
  node: declaredNode,
  go: (dir, _dirs, realRoots) => declaredGo(dir, realRoots),
  rust: declaredRust,
  ios: declaredIos,
  android: (dir, dirs, realRoots, catalogCache) =>
    declaredGradle(
      dir,
      dirs,
      realRoots,
      'posthog-android',
      [
        'app/build.gradle.kts',
        'app/build.gradle',
        'build.gradle.kts',
        'build.gradle',
      ],
      catalogCache,
    ),
  flutter: declaredFlutter,
  kmp: (dir, dirs, realRoots, catalogCache) =>
    declaredGradle(
      dir,
      dirs,
      realRoots,
      'posthog-kmp',
      [
        'shared/build.gradle.kts',
        'shared/build.gradle',
        'composeApp/build.gradle.kts',
        'composeApp/build.gradle',
        'build.gradle.kts',
        'build.gradle',
      ],
      catalogCache,
    ),
};

/**
 * The SDK declared in `dir` (with `workspaceDir` checked for shared lockfiles
 * or catalogs): its major, and the lockfile's version, else the lowest the
 * manifest allows. Undefined when absent, ambiguous, or malformed; never throws.
 */
export function declaredSdk(
  dir: string,
  sdk: PostHogSdk,
  workspaceDir?: string,
  catalogCache?: GradleCatalogCache,
): DeclaredSdk | undefined {
  try {
    if (!fs.statSync(dir).isDirectory()) return undefined;
    const dirs = searchDirs(dir, workspaceDir);
    const realRoots = resolveRealRoots(dirs);
    if (realRoots.length === 0) return undefined;
    const realDir = fs.realpathSync(dir);
    const declared = DETECTORS[sdk](
      realDir,
      realRoots,
      realRoots,
      catalogCache,
    );
    if (!declared) return undefined;
    const resolved = declared.resolved();
    const major = rangeMajor(declared.range) ?? rangeMajor(resolved ?? '');
    if (major === undefined) return undefined;
    const version = [resolved, declared.range]
      .map((v) => (v ? rangeFloor(v) : undefined))
      .find((v) => v !== undefined && rangeMajor(v) === major);
    return { major: String(major), ...(version && { version }) };
  } catch {
    return undefined;
  }
}

/** Major version of `sdk` declared in `dir`; see `declaredSdk`. */
export function declaredSdkMajor(
  dir: string,
  sdk: PostHogSdk,
  workspaceDir?: string,
  catalogCache?: GradleCatalogCache,
): string | undefined {
  return declaredSdk(dir, sdk, workspaceDir, catalogCache)?.major;
}
