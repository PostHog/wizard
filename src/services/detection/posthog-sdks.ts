/**
 * Bounded upfront scanner for existing PostHog SDK dependencies, major versions,
 * and constraint shapes (pinned vs range) across supported ecosystems.
 */

import fs from 'fs';
import path from 'path';
import semver from 'semver';
import { isFlaggedInput } from '@agent';
import type {
  ProgramConfig,
  ProgramReadyContext,
  ProgramSession,
} from '@programs/program-contract';
import type { PostHogSdkKey } from '@shared/posthog-sdks';
import { safeReadFile, walkProjectFiles } from '@utils/bounded-fs';
import { logToFile } from '@utils/debug';
import {
  sanitizeReportedPath,
  toPromptSafeRelativePath,
} from '@utils/env-scan';
import { POSTHOG_SDKS } from './package-scanning';

/** Session `frameworkContext` key storing detected PostHog SDK entries. */
export const POSTHOG_SDKS_KEY = 'posthogSdks';

/** Session `frameworkContext` key recording which directory `POSTHOG_SDKS_KEY` scanned. */
const POSTHOG_SDKS_DIR_KEY = 'posthogSdksDir';

export type SdkConstraintKind = 'pinned' | 'range' | 'unknown';

export interface DetectedPostHogSdk {
  key: PostHogSdkKey;
  packageName: string;
  major: number;
  resolvedVersion?: string;
  constraintKind: SdkConstraintKind;
  rawSpec: string;
  source: string;
}

const MAX_SCAN_DEPTH = 3;
const MAX_SEMVER_SPEC_LENGTH = 256;
const MAX_SAFE_RAW_SPEC_LENGTH = 80;
/** Most SDK facts one prompt carries, however many manifests were scanned. */
export const MAX_SDK_FACTS = 8;
const EXACT_SEMVER_RE = /^[=v\s]*(\d+\.\d+\.\d+(?:[-+][^\s,;]+)?)$/;
const WILDCARD_SPEC_RE = /^(?:[*xX]+|latest|workspace:\*)$/;
const SAFE_RESOLVED_VERSION_RE = /^[A-Za-z0-9._+-]{1,64}$/;
const CONSTRAINT_PREFIX_CHARS = new Set(['>', '<', '=', '~', '^', '!']);
const MAJOR_SUFFIX_DELIMITERS = new Set([
  '.',
  ' ',
  '\t',
  '\r',
  '\n',
  ',',
  '<',
  '>',
]);

function sanitizeResolvedVersion(
  version: string | undefined,
): string | undefined {
  if (!version) return undefined;
  const trimmed = version.trim();
  return SAFE_RESOLVED_VERSION_RE.test(trimmed) &&
    isSafeVersionConstraint(trimmed)
    ? trimmed
    : undefined;
}

const MAX_SPEC_CLAUSES = 8;
const MAX_LETTERED_CLAUSES = 2;
const MAX_SUFFIX_LENGTH = 24;
const MAX_PRERELEASE_SEGMENTS = 4;
const MAX_BUILD_SEGMENTS = 3;
const MAX_BUILD_SEGMENT_LENGTH = 12;
const MAX_TAG_LETTERS = 8;
const MAX_TAG_DIGITS = 9;
const SPEC_OPERATORS = [
  '===',
  '==',
  '!=',
  '>=',
  '<=',
  '~=',
  '~>',
  '^',
  '~',
  '>',
  '<',
  '=',
];
// Pre-release tags that may follow the digits directly, as in `1.0rc1`.
const ATTACHED_TAGS = new Set([
  'a',
  'b',
  'c',
  'rc',
  'alpha',
  'beta',
  'pre',
  'preview',
  'post',
  'dev',
]);
// Closed set of pre-release and build words a tag segment may use, optionally followed by digits.
const TAG_WORDS = new Set([
  'alpha',
  'beta',
  'rc',
  'a',
  'b',
  'c',
  'dev',
  'post',
  'pre',
  'preview',
  'next',
  'canary',
  'nightly',
  'snapshot',
  'final',
  'ga',
  'm',
  'release',
  'build',
  'sha',
  'git',
  'x',
  'local',
  'exp',
  'meta',
]);
const COMMIT_ID_RE = /^[0-9a-f]{7,40}$/i;
const GO_MODULE_PREFIX = 'github.com/posthog/posthog-go';

const isDigit = (c: string | undefined): boolean =>
  c !== undefined && c >= '0' && c <= '9';
const isAlpha = (c: string | undefined): boolean =>
  c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'));
const isAlnum = (c: string | undefined): boolean => isDigit(c) || isAlpha(c);
const isBlank = (c: string | undefined): boolean => c === ' ';
const isWildcard = (c: string | undefined): boolean =>
  c === '*' || c === 'x' || c === 'X';

function skipBlanks(s: string, i: number): number {
  return isBlank(s[i]) ? i + 1 : i;
}

function skipWhile(s: string, i: number, test: (c: string) => boolean): number {
  while (i < s.length && test(s[i])) i++;
  return i;
}

const isCommitId = (seg: string): boolean =>
  COMMIT_ID_RE.test(seg) && /[a-f]/i.test(seg);

/** A segment of digits, or an allowed tag word followed by digits. */
function isTagSegment(seg: string, letters: number, digits: number): boolean {
  if (letters + digits !== seg.length) return false;
  return letters === 0 || TAG_WORDS.has(seg.slice(0, letters).toLowerCase());
}

/** One dot/dash/underscore-joined run of short alphanumeric segments; returns its end and whether it holds a letter. */
function scanSegments(
  s: string,
  start: number,
  kind: 'attached' | 'pre' | 'build',
): { end: number; lettered: boolean } | undefined {
  const maxSegments =
    kind === 'build' ? MAX_BUILD_SEGMENTS : MAX_PRERELEASE_SEGMENTS;
  let i = start;
  let lettered = false;
  for (let n = 0; n < maxSegments; n++) {
    const segStart = i;
    i = skipWhile(s, i, isAlnum);
    const seg = s.slice(segStart, i);
    const letters = skipWhile(seg, 0, isAlpha);
    const digits = skipWhile(seg, letters, isDigit) - letters;
    const attachedHead = kind === 'attached' && n === 0;
    const commitId = !attachedHead && isCommitId(seg);
    if (kind === 'build') {
      if (seg.length === 0 || seg.length > MAX_BUILD_SEGMENT_LENGTH) {
        return undefined;
      }
      if (!commitId && !isTagSegment(seg, letters, digits)) return undefined;
      lettered = lettered || letters > 0 || commitId;
    } else if (commitId) {
      lettered = true;
    } else {
      if (seg.length === 0 || letters + digits !== seg.length) return undefined;
      if (letters > MAX_TAG_LETTERS || digits > MAX_TAG_DIGITS)
        return undefined;
      if (
        attachedHead &&
        !ATTACHED_TAGS.has(seg.slice(0, letters).toLowerCase())
      ) {
        return undefined;
      }
      if (letters > 0 && !TAG_WORDS.has(seg.slice(0, letters).toLowerCase())) {
        return undefined;
      }
      lettered = lettered || letters > 0;
    }
    if (i - start > MAX_SUFFIX_LENGTH) return undefined;
    const joiner = s[i];
    if (
      (joiner !== '.' && joiner !== '-' && joiner !== '_') ||
      !isAlnum(s[i + 1])
    ) {
      return { end: i, lettered };
    }
    i++;
  }
  return undefined;
}

/** Pre-release and build suffix after a numeric core; returns its end, or undefined when malformed. */
function scanSuffix(
  s: string,
  start: number,
): { end: number; lettered: boolean } | undefined {
  let i = start;
  let lettered = false;
  const c = s[i];
  if (c === '-' || c === '.' || c === '_') {
    const pre = scanSegments(s, i + 1, 'pre');
    if (!pre) return undefined;
    i = pre.end;
    lettered = pre.lettered;
  } else if (isAlpha(c)) {
    const tag = scanSegments(s, i, 'attached');
    if (!tag) return undefined;
    i = tag.end;
    lettered = tag.lettered;
  }
  if (s[i] === '+') {
    const build = scanSegments(s, i + 1, 'build');
    if (!build) return undefined;
    i = build.end;
    lettered = lettered || build.lettered;
  }
  return { end: i, lettered };
}

/** Numeric core `v?1(.2|.x){0,3}`; returns its end. */
function scanVersionCore(s: string, start: number): number {
  let i = start;
  if (s[i] === 'v') i++;
  const digitsEnd = skipWhile(s, i, isDigit);
  if (digitsEnd === i) return -1;
  i = digitsEnd;
  for (let n = 0; n < 3 && s[i] === '.'; n++) {
    if (isDigit(s[i + 1])) {
      i = skipWhile(s, i + 1, isDigit);
    } else if (isWildcard(s[i + 1])) {
      i += 2;
    } else {
      break;
    }
  }
  return i;
}

function scanClause(
  s: string,
  start: number,
): { end: number; lettered: boolean } | undefined {
  let i = start;
  const op = SPEC_OPERATORS.find((o) => s.startsWith(o, i));
  if (op) i = skipBlanks(s, i + op.length);
  if (isWildcard(s[i])) {
    return { end: i + 1, lettered: false };
  }
  for (const word of ['latest', 'workspace:*']) {
    if (s.startsWith(word, i)) return { end: i + word.length, lettered: false };
  }
  const core = scanVersionCore(s, i);
  if (core < 0) return undefined;
  return scanSuffix(s, core);
}

function isSafeVersionConstraint(s: string): boolean {
  let i = 0;
  let clauses = 0;
  let lettered = 0;
  for (;;) {
    const clause = scanClause(s, i);
    if (!clause) return false;
    clauses++;
    if (clause.lettered) lettered++;
    if (clauses > MAX_SPEC_CLAUSES || lettered > MAX_LETTERED_CLAUSES) {
      return false;
    }
    i = clause.end;
    if (i === s.length) return true;
    const gapEnd = skipBlanks(s, i);
    const hadGap = gapEnd > i;
    if (s.startsWith('||', gapEnd)) {
      i = skipBlanks(s, gapEnd + 2);
    } else if (s[gapEnd] === ',') {
      i = skipBlanks(s, gapEnd + 1);
    } else if (hadGap && s[gapEnd] === '-' && isBlank(s[gapEnd + 1])) {
      i = skipBlanks(s, gapEnd + 1);
    } else if (hadGap) {
      i = gapEnd;
    } else {
      return false;
    }
  }
}

function isSafeGoModuleSpec(s: string): boolean {
  if (!s.startsWith(GO_MODULE_PREFIX)) return false;
  let i = GO_MODULE_PREFIX.length;
  if (s.startsWith('/v', i)) {
    const end = skipWhile(s, i + 2, isDigit);
    if (end === i + 2) return false;
    i = end;
  }
  const gap = skipBlanks(s, i);
  if (gap === i || s[gap] !== 'v') return false;
  let j = gap + 1;
  for (let n = 0; n < 3; n++) {
    const end = skipWhile(s, j, isDigit);
    if (end === j) return false;
    j = end;
    if (n < 2) {
      if (s[j] !== '.') return false;
      j++;
    }
  }
  const suffix = scanSuffix(s, j);
  return suffix !== undefined && suffix.end === s.length;
}

/** Linear allowlist for a version constraint: operators, bounded numeric cores, short tags, and few clauses. */
function isSafeRawSpec(s: string): boolean {
  return s === 'posthog' || isSafeGoModuleSpec(s) || isSafeVersionConstraint(s);
}

/** Restrict a manifest SDK constraint string to single-line version/module syntax, falling back to `${major}.x`. */
export function sanitizeRawSpec(rawSpec: string, major: number): string {
  const trimmed = rawSpec.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_SAFE_RAW_SPEC_LENGTH) {
    return `${major}.x`;
  }
  return isSafeRawSpec(trimmed) ? trimmed : `${major}.x`;
}

function extractLeadingMajor(trimmed: string): number | undefined {
  let i = 0;
  const len = trimmed.length;
  while (i < len && (trimmed[i] === ' ' || trimmed[i] === '\t')) i++;
  while (i < len && CONSTRAINT_PREFIX_CHARS.has(trimmed[i])) i++;
  while (i < len && (trimmed[i] === ' ' || trimmed[i] === '\t')) i++;
  if (i < len && (trimmed[i] === 'v' || trimmed[i] === 'V')) i++;
  const start = i;
  while (i < len) {
    const code = trimmed.charCodeAt(i);
    if (code < 48 || code > 57) break;
    i++;
  }
  if (i === start) return undefined;
  if (i < len && !MAJOR_SUFFIX_DELIMITERS.has(trimmed[i])) return undefined;
  return Number(trimmed.slice(start, i));
}

const EXCLUSIVE_UPPER_RE =
  /^[ \t]*<[ \t]*v?\d+(?:\.([0-9xX*]+))?(?:\.([0-9xX*]+))?(?![.0-9A-Za-z*])/;
const ZERO_LOWER_RE = /(?:^|[ \t])>=[ \t]*v?0/;
const WILDCARD_PART_RE = /^[xX*]$/;

const isZeroPart = (p: string | undefined): boolean =>
  p === undefined || p === '0' || WILDCARD_PART_RE.test(p);

function isExclusiveBoundAtMajor(trimmed: string): boolean {
  const m = EXCLUSIVE_UPPER_RE.exec(trimmed);
  if (!m) return false;
  // A wildcard minor zeroes everything after it, as in semver.
  return (
    (m[1] !== undefined && WILDCARD_PART_RE.test(m[1])) ||
    (isZeroPart(m[1]) && isZeroPart(m[2]))
  );
}

function readNonSymlinkProjectFile(
  filePath: string,
  realRoot?: string,
): string | null {
  try {
    if (fs.lstatSync(filePath).isSymbolicLink()) return null;
    if (realRoot) {
      const real = fs.realpathSync(filePath);
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
        return null;
      }
    }
    return safeReadFile(filePath);
  } catch {
    return null;
  }
}

/** Major of one `||` branch: the highest lower bound's, else the exclusive upper bound's. */
function semverBranchMajor(branch: string): number | undefined {
  let lower: number | undefined;
  let upper: number | undefined;
  for (const comparators of new semver.Range(branch).set) {
    for (const c of comparators) {
      if (c.value === '') continue;
      if (c.operator === '<' || c.operator === '<=') {
        const atMajor =
          c.operator === '<' && c.semver.minor === 0 && c.semver.patch === 0;
        const major = atMajor ? c.semver.major - 1 : c.semver.major;
        upper = upper === undefined ? major : Math.min(upper, major);
      } else {
        lower = Math.max(lower ?? 0, c.semver.major);
      }
    }
  }
  // `semver` drops a zero lower bound such as `>=0` or `0.x`; restore it from the text.
  if (lower === undefined && ZERO_LOWER_RE.test(branch)) lower = 0;
  const major = lower ?? upper;
  return major !== undefined && major >= 0 ? major : undefined;
}

/** Same rule as `semverBranchMajor` for specs `semver` rejects, read clause by clause. */
function textBranchMajor(branch: string): number | undefined {
  let lower: number | undefined;
  let upper: number | undefined;
  const clauses = branch.replace(/([<>=~^!]+)[ \t]+/g, '$1').split(/[ \t]+/);
  for (const clause of clauses) {
    if (clause === '') continue;
    const lead = extractLeadingMajor(clause);
    if (lead === undefined) return undefined;
    if (clause.startsWith('<')) {
      const major = isExclusiveBoundAtMajor(clause) ? lead - 1 : lead;
      upper = upper === undefined ? major : Math.min(upper, major);
    } else if (!clause.startsWith('!')) {
      lower = Math.max(lower ?? 0, lead);
    }
  }
  const major = lower ?? upper;
  return major !== undefined && major >= 0 ? major : undefined;
}

const INTERVAL_RE =
  /^([[(])[ \t]*([^,[\]()\s]*)[ \t]*(?:(,)[ \t]*([^,[\]()\s]*)[ \t]*)?([\])])$/;

/** Maven and Gradle interval: the lower bound's major, else the upper bound's by the `<` / `<=` rule; `[a]` pins. */
function parseIntervalConstraint(s: string): {
  major?: number;
  resolvedVersion?: string;
  constraintKind: SdkConstraintKind;
} {
  const m = INTERVAL_RE.exec(s);
  if (!m) return { constraintKind: 'unknown' };
  const [, open, lower, comma, upper, close] = m;
  if (!comma) {
    const major = /^\d/.test(lower) ? extractLeadingMajor(lower) : undefined;
    if (open !== '[' || close !== ']' || major === undefined) {
      return { constraintKind: 'unknown' };
    }
    const valid = semver.valid(lower);
    return {
      major,
      resolvedVersion: valid ? sanitizeResolvedVersion(valid) : undefined,
      constraintKind: 'pinned',
    };
  }
  let major: number | undefined;
  if (lower) {
    major = /^\d/.test(lower) ? extractLeadingMajor(lower) : undefined;
  } else if (/^\d/.test(upper)) {
    const lead = extractLeadingMajor(upper);
    const bound = `${close === ')' ? '<' : '<='}${upper}`;
    major =
      lead !== undefined && isExclusiveBoundAtMajor(bound) ? lead - 1 : lead;
  }
  return major !== undefined && major >= 0
    ? { major, constraintKind: 'range' }
    : { constraintKind: 'unknown' };
}

function lowestBranchMajor(
  spec: string,
  branchMajor: (branch: string) => number | undefined,
  strict = false,
): number | undefined {
  let best: number | undefined;
  for (const branch of spec.split('||')) {
    const major = branchMajor(branch);
    if (major === undefined && strict) return undefined;
    if (major !== undefined)
      best = best === undefined ? major : Math.min(best, major);
  }
  return best;
}

// Major rule: per `||` branch the highest lower bound's major (else the exclusive upper's), lowest branch wins; clause order and `,` never matter.
function parseSemverConstraint(rawSpec: string): {
  major?: number;
  resolvedVersion?: string;
  constraintKind: SdkConstraintKind;
} {
  const trimmed = rawSpec.trim().replace(/^["']|["']$/g, '');
  if (!trimmed || trimmed.length > MAX_SEMVER_SPEC_LENGTH) {
    return { constraintKind: 'unknown' };
  }
  if (WILDCARD_SPEC_RE.test(trimmed)) {
    return { constraintKind: 'range' };
  }
  if (/[[\]()]/.test(trimmed)) return parseIntervalConstraint(trimmed);

  const exact = trimmed.match(EXACT_SEMVER_RE);
  if (exact && !trimmed.includes('||') && !trimmed.includes(' ')) {
    const valid = semver.valid(exact[1]);
    if (valid) {
      return {
        major: semver.major(valid),
        resolvedVersion: sanitizeResolvedVersion(valid),
        constraintKind: 'pinned',
      };
    }
  }

  // Cargo-style commas mean the same as spaces.
  const normalized = trimmed.replace(/,/g, ' ');
  const major =
    (semver.validRange(normalized)
      ? lowestBranchMajor(normalized, semverBranchMajor)
      : undefined) ?? lowestBranchMajor(normalized, textBranchMajor, true);
  if (major !== undefined) return { major, constraintKind: 'range' };
  return { constraintKind: 'unknown' };
}

function parsePythonConstraint(rawSpec: string): {
  major?: number;
  resolvedVersion?: string;
  constraintKind: SdkConstraintKind;
} {
  const cleaned = rawSpec.trim();
  if (!cleaned || cleaned.length > MAX_SEMVER_SPEC_LENGTH) {
    return { constraintKind: 'range' };
  }

  // Hard pin `==7.40.0` or `===7.40.0` (wildcard `==7.*` is a range)
  const hardPin = cleaned.match(
    /^={2,3}\s*(\d+\.\d+(?:\.\d+)?(?:[a-zA-Z0-9.+-]+)?)$/,
  );
  if (hardPin && !hardPin[1].includes('*')) {
    const major = Number(hardPin[1].split('.')[0]);
    return {
      major,
      resolvedVersion: sanitizeResolvedVersion(hardPin[1]),
      constraintKind: 'pinned',
    };
  }

  // Extract lower-bound version from `>=7.40.0,<8`, `~=7.40`, `~7.40`, `^7.40.0`, `==7.*`
  const lowerMatch =
    cleaned.match(/(?:>=|~=|~|\^|===?|>)\s*(\d+(?:\.\d+(?:\.\d+)?)?)/) ??
    cleaned.match(/<=\s*(\d+(?:\.\d+(?:\.\d+)?)?)/) ??
    cleaned.match(/^\s*(\d+(?:\.\d+(?:\.\d+)?)?)/);
  if (lowerMatch) {
    const parts = lowerMatch[1].split('.');
    const major = Number(parts[0]);
    if (Number.isInteger(major)) {
      return {
        major,
        constraintKind: 'range',
      };
    }
  }
  // Upper-bound only: `<7.0.0` / `<7` allows up to major 6; `<7.5` allows 7.x.
  const upperMatch = /<\s*(\d+(?:\.\d+){0,2})/.exec(cleaned);
  if (upperMatch) {
    const parts = upperMatch[1].split('.').map(Number);
    const major = parts[0];
    const rest = cleaned.slice(upperMatch.index + upperMatch[0].length);
    // Extra release parts or a pre/post/local suffix still allow `M.0.0` itself.
    const hasSuffix = /^(?:[A-Za-z+_-]|\.[A-Za-z0-9])/.test(rest);
    const exclusiveAtMajor = !hasSuffix && parts.slice(1).every((n) => n === 0);
    const effective = exclusiveAtMajor ? major - 1 : major;
    if (Number.isInteger(effective) && effective >= 0) {
      return { major: effective, constraintKind: 'range' };
    }
  }
  return { constraintKind: 'range' };
}

type LockfileReader = {
  getNpmLockVersion: (
    manifestDir: string,
    pkgName: string,
  ) => string | undefined;
  getPythonLockVersion: (manifestDir: string) => string | undefined;
  getCargoLockVersion: (
    manifestDir: string,
    crateName: string,
  ) => string | undefined;
};

type ProjectFileReader = (filePath: string) => string | null;

/** Npm packages whose installed version a lockfile lookup may return. */
const NPM_LOCK_PACKAGES = ['posthog-node'];

/** The PostHog entries of one `package-lock.json`: `packages` by key and legacy `dependencies` by name. */
type NpmLockFacts = {
  packages: Map<string, string>;
  dependencies: Map<string, string>;
};

/** The PostHog versions of one `pnpm-lock.yaml`: per importer, plus the first `name@version` seen. */
type PnpmLockFacts = {
  importers: PnpmImporterIndex;
  fallback: Map<string, string | undefined>;
};

/** Per-scan memo of what each lookup needs from a lockfile, keyed by file path; never the file text. */
type LockParseCache = {
  installed: Map<string, string | undefined>;
  npmLock: Map<string, NpmLockFacts | null>;
  pnpmLock: Map<string, PnpmLockFacts | null>;
  pythonLock: Map<string, string | undefined>;
  cargoLock: Map<string, string | undefined>;
};

function memo<V>(cache: Map<string, V>, key: string, compute: () => V): V {
  if (!cache.has(key)) cache.set(key, compute());
  return cache.get(key) as V;
}

function ancestorDirsToRoot(manifestDir: string, realRoot?: string): string[] {
  if (!realRoot) return [manifestDir];
  let current: string;
  try {
    current = fs.realpathSync(manifestDir);
  } catch {
    return [];
  }
  if (current !== realRoot && !current.startsWith(realRoot + path.sep)) {
    return [];
  }
  const dirs: string[] = [];
  for (;;) {
    dirs.push(current);
    if (current === realRoot) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs;
}

function stripYamlQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

type PnpmImporterIndex = Map<string, Map<string, string | undefined>>;

/** Index `importers:` once as importer key -> PostHog package -> first declared version. */
function indexPnpmImporters(pnpmLock: string): PnpmImporterIndex {
  const index: PnpmImporterIndex = new Map();
  let inImporters = false;
  let importer: string | undefined;
  let inDepSection = false;
  let targetPkg: string | undefined;

  for (const rawLine of pnpmLock.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const trimmed = rawLine.trim();

    if (indent === 0) {
      inImporters = trimmed === 'importers:';
      importer = undefined;
      inDepSection = false;
      targetPkg = undefined;
      continue;
    }
    if (!inImporters) continue;

    if (indent === 2 && trimmed.endsWith(':')) {
      importer = stripYamlQuotes(trimmed.slice(0, -1));
      inDepSection = false;
      targetPkg = undefined;
      continue;
    }
    if (importer === undefined) continue;

    if (indent === 4 && trimmed.endsWith(':')) {
      const sec = stripYamlQuotes(trimmed.slice(0, -1));
      inDepSection =
        sec === 'dependencies' ||
        sec === 'devDependencies' ||
        sec === 'optionalDependencies';
      targetPkg = undefined;
      continue;
    }
    if (!inDepSection) continue;

    if (indent === 6 && trimmed.endsWith(':')) {
      targetPkg = stripYamlQuotes(trimmed.slice(0, -1));
      continue;
    }
    if (
      targetPkg !== undefined &&
      NPM_LOCK_PACKAGES.includes(targetPkg) &&
      indent >= 8 &&
      trimmed.startsWith('version:') &&
      !index.get(importer)?.has(targetPkg)
    ) {
      const rawVer = stripYamlQuotes(trimmed.slice('version:'.length));
      const clean = rawVer.split(/[(:]/, 1)[0].trim();
      const versions =
        index.get(importer) ?? new Map<string, string | undefined>();
      versions.set(targetPkg, sanitizeResolvedVersion(clean));
      index.set(importer, versions);
    }
  }
  return index;
}

function extractPnpmLockFacts(pnpmLock: string): PnpmLockFacts {
  const fallback = new Map<string, string | undefined>();
  for (const pkgName of NPM_LOCK_PACKAGES) {
    const escaped = pkgName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `(?:^|[\\s'"/])${escaped}@(\\d+\\.\\d+\\.\\d+[^'":(\\s]*)`,
      'm',
    );
    const match = pnpmLock.match(re);
    if (match) fallback.set(pkgName, sanitizeResolvedVersion(match[1]));
  }
  return { importers: indexPnpmImporters(pnpmLock), fallback };
}

function extractNpmLockFacts(pkgLock: string): NpmLockFacts | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(pkgLock);
  } catch {
    return null; // skip malformed lockfile
  }
  const facts: NpmLockFacts = { packages: new Map(), dependencies: new Map() };
  if (typeof parsed !== 'object' || parsed === null) return facts;
  const { packages, dependencies } = parsed as {
    packages?: unknown;
    dependencies?: unknown;
  };
  const versionOf = (entry: unknown): string | undefined => {
    const v = (entry as { version?: unknown } | null)?.version;
    return typeof v === 'string' ? v : undefined;
  };
  for (const pkgName of NPM_LOCK_PACKAGES) {
    if (typeof dependencies === 'object' && dependencies !== null) {
      const v = versionOf((dependencies as Record<string, unknown>)[pkgName]);
      if (v !== undefined) facts.dependencies.set(pkgName, v);
    }
  }
  if (typeof packages === 'object' && packages !== null) {
    for (const [key, entry] of Object.entries(packages)) {
      const v = versionOf(entry);
      if (v === undefined) continue;
      const isPosthog = NPM_LOCK_PACKAGES.some(
        (name) =>
          key === `node_modules/${name}` ||
          key.endsWith(`/node_modules/${name}`),
      );
      if (isPosthog) facts.packages.set(key, v);
    }
  }
  return facts;
}

function readInstalledNpmVersion(
  dir: string,
  pkgName: string,
  readFile: ProjectFileReader,
  cache: LockParseCache,
): string | undefined {
  const manifestPath = path.join(dir, 'node_modules', pkgName, 'package.json');
  return memo(cache.installed, manifestPath, () => {
    const raw = readFile(manifestPath);
    if (!raw) return undefined;
    try {
      const manifest = JSON.parse(raw) as { version?: unknown };
      return typeof manifest.version === 'string'
        ? sanitizeResolvedVersion(manifest.version)
        : undefined;
    } catch {
      return undefined;
    }
  });
}

function readNpmLockVersion(
  manifestDir: string,
  pkgName: string,
  realRoot: string | undefined,
  readFile: ProjectFileReader,
  cache: LockParseCache,
): string | undefined {
  const ancestors = ancestorDirsToRoot(manifestDir, realRoot);
  const realManifestDir = ancestors[0];

  for (const dir of ancestors) {
    const fromNodeModules = readInstalledNpmVersion(
      dir,
      pkgName,
      readFile,
      cache,
    );
    if (fromNodeModules) return fromNodeModules;

    const relManifest = realManifestDir
      ? path
          .relative(dir, realManifestDir)
          .split(path.sep)
          .filter(Boolean)
          .join('/')
      : '';

    const pkgLockPath = path.join(dir, 'package-lock.json');
    const lock = memo(cache.npmLock, pkgLockPath, () => {
      const text = readFile(pkgLockPath);
      return text ? extractNpmLockFacts(text) : null;
    });
    if (lock) {
      const scopedPkgKey = relManifest
        ? `${relManifest}/node_modules/${pkgName}`
        : undefined;
      const v =
        (scopedPkgKey ? lock.packages.get(scopedPkgKey) : undefined) ??
        lock.packages.get(`node_modules/${pkgName}`) ??
        lock.dependencies.get(pkgName);
      const safe = sanitizeResolvedVersion(v);
      if (safe) return safe;
    }

    const pnpmPath = path.join(dir, 'pnpm-lock.yaml');
    const pnpm = memo(cache.pnpmLock, pnpmPath, () => {
      const text = readFile(pnpmPath);
      return text ? extractPnpmLockFacts(text) : null;
    });
    if (pnpm) {
      const fromImporter = pnpm.importers.get(relManifest || '.')?.get(pkgName);
      if (fromImporter) return fromImporter;
      if (pnpm.fallback.has(pkgName)) return pnpm.fallback.get(pkgName);
    }
  }

  return undefined;
}

const PYTHON_LOCK_RE =
  /\[\[package\]\][ \t]*\r?\nname[ \t]*=[ \t]*"posthog"[ \t]*\r?\nversion[ \t]*=[ \t]*"([^"]+)"/;

function readPythonLockVersion(
  manifestDir: string,
  realRoot: string | undefined,
  readFile: ProjectFileReader,
  cache: LockParseCache,
): string | undefined {
  for (const dir of ancestorDirsToRoot(manifestDir, realRoot)) {
    for (const name of ['uv.lock', 'poetry.lock']) {
      const lockPath = path.join(dir, name);
      const version = memo(cache.pythonLock, lockPath, () => {
        const lock = readFile(lockPath);
        const match = lock ? PYTHON_LOCK_RE.exec(lock) : null;
        return match ? sanitizeResolvedVersion(match[1]) : undefined;
      });
      if (version) return version;
    }
  }
  return undefined;
}

function readCargoLockVersion(
  manifestDir: string,
  crateName: string,
  realRoot: string | undefined,
  readFile: ProjectFileReader,
  cache: LockParseCache,
): string | undefined {
  for (const dir of ancestorDirsToRoot(manifestDir, realRoot)) {
    const lockPath = path.join(dir, 'Cargo.lock');
    const version = memo(cache.cargoLock, `${lockPath}\0${crateName}`, () => {
      const cargoLock = readFile(lockPath);
      if (!cargoLock) return undefined;
      const escaped = crateName.replace('-', '\\-');
      const re = new RegExp(
        `\\[\\[package\\]\\][ \\t]*\\r?\\nname[ \\t]*=[ \\t]*"${escaped}"[ \\t]*\\r?\\nversion[ \\t]*=[ \\t]*"([^"]+)"`,
      );
      const match = re.exec(cargoLock);
      return match ? sanitizeResolvedVersion(match[1]) : undefined;
    });
    if (version) return version;
  }
  return undefined;
}

function createLockfileReader(realRoot?: string): LockfileReader {
  const readFile: ProjectFileReader = (filePath) =>
    readNonSymlinkProjectFile(filePath, realRoot);
  const parseCache: LockParseCache = {
    installed: new Map(),
    npmLock: new Map(),
    pnpmLock: new Map(),
    pythonLock: new Map(),
    cargoLock: new Map(),
  };
  const npmCache = new Map<string, string | undefined>();
  const pythonCache = new Map<string, string | undefined>();
  const cargoCache = new Map<string, string | undefined>();
  return {
    getNpmLockVersion(manifestDir, pkgName) {
      const key = `${manifestDir}\0${pkgName}`;
      if (!npmCache.has(key)) {
        npmCache.set(
          key,
          readNpmLockVersion(
            manifestDir,
            pkgName,
            realRoot,
            readFile,
            parseCache,
          ),
        );
      }
      return npmCache.get(key);
    },
    getPythonLockVersion(manifestDir) {
      if (!pythonCache.has(manifestDir)) {
        pythonCache.set(
          manifestDir,
          readPythonLockVersion(manifestDir, realRoot, readFile, parseCache),
        );
      }
      return pythonCache.get(manifestDir);
    },
    getCargoLockVersion(manifestDir, crateName) {
      const key = `${manifestDir}\0${crateName}`;
      if (!cargoCache.has(key)) {
        cargoCache.set(
          key,
          readCargoLockVersion(
            manifestDir,
            crateName,
            realRoot,
            readFile,
            parseCache,
          ),
        );
      }
      return cargoCache.get(key);
    },
  };
}

function resolveVersionWithLock(
  parsed: {
    major?: number;
    resolvedVersion?: string;
    constraintKind: SdkConstraintKind;
  },
  readLock: () => string | undefined,
): { major?: number; resolvedVersion?: string } {
  const lockVer =
    parsed.constraintKind === 'pinned' || parsed.resolvedVersion
      ? undefined
      : sanitizeResolvedVersion(readLock());
  const resolvedVersion = parsed.resolvedVersion ?? lockVer;
  const lockMajor =
    lockVer && /^\d+/.test(lockVer) ? Number(lockVer.split('.')[0]) : undefined;
  const validLockMajor =
    lockMajor !== undefined && Number.isInteger(lockMajor)
      ? lockMajor
      : undefined;
  const major =
    parsed.constraintKind === 'pinned'
      ? parsed.major
      : validLockMajor ?? parsed.major;
  return {
    major: major !== undefined && Number.isInteger(major) ? major : undefined,
    resolvedVersion,
  };
}

function parsePackageJsonSdks(
  fullPath: string,
  relPath: string,
  locks: LockfileReader,
): { sdks: DetectedPostHogSdk[]; hasAnyNpmSdk: boolean } {
  const content = safeReadFile(fullPath);
  if (!content) return { sdks: [], hasAnyNpmSdk: false };
  try {
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    const merged: Record<string, string> = {
      ...(pkg.optionalDependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
      ...(pkg.dependencies ?? {}),
    };
    const hasAnyNpmSdk = Object.keys(merged).some((dep) =>
      POSTHOG_SDKS.has(dep),
    );
    const manifestDir = path.dirname(fullPath);
    const results: DetectedPostHogSdk[] = [];
    if (merged['posthog-node']) {
      const rawSpec = merged['posthog-node'];
      const parsed = parseSemverConstraint(rawSpec);
      const lockVer =
        parsed.constraintKind === 'pinned' || parsed.resolvedVersion
          ? undefined
          : locks.getNpmLockVersion(manifestDir, 'posthog-node');
      const validLockVer =
        lockVer && semver.valid(lockVer) ? lockVer : undefined;
      const lockMajor = validLockVer ? semver.major(validLockVer) : undefined;
      const major =
        parsed.constraintKind === 'pinned'
          ? parsed.major
          : lockMajor ?? parsed.major;
      if (major !== undefined) {
        results.push({
          key: 'posthog-node',
          packageName: 'posthog-node',
          major,
          resolvedVersion: parsed.resolvedVersion ?? validLockVer,
          constraintKind: parsed.constraintKind,
          rawSpec: sanitizeRawSpec(rawSpec, major),
          source: relPath,
        });
      }
    }
    return { sdks: results, hasAnyNpmSdk };
  } catch {
    return { sdks: [], hasAnyNpmSdk: false };
  }
}

function stripLineComment(line: string, marker: string): string {
  const idx = line.indexOf(marker);
  return idx === -1 ? line : line.slice(0, idx);
}

/** Linear-time block-comment stripper; an unclosed block drops the remainder. */
function stripBlockComments(content: string): string {
  let out = '';
  let i = 0;
  while (i < content.length) {
    const start = content.indexOf('/*', i);
    if (start === -1) {
      out += content.slice(i);
      break;
    }
    out += content.slice(i, start);
    const end = content.indexOf('*/', start + 2);
    if (end === -1) break;
    i = end + 2;
  }
  return out;
}

function stripLineComments(content: string, marker: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => stripLineComment(line, marker))
    .join('\n');
}

const REQUIREMENT_NAME_RE = /^posthog(?:\[[^\]]*\])?/i;
const REQUIREMENT_NAME_CHAR_RE = /^[A-Za-z0-9._-]/;
const LINE_BREAK_RE = /[\r\u2028\u2029]/;

function parseRequirementsTxt(
  fullPath: string,
  relPath: string,
  locks: LockfileReader,
): DetectedPostHogSdk[] {
  const content = safeReadFile(fullPath);
  if (!content) return [];
  const manifestDir = path.dirname(fullPath);
  for (const rawLine of content.split(/\r?\n/)) {
    const code = stripLineComment(rawLine, '#').split(';', 1)[0].trim();
    if (!code || code.startsWith('-')) continue;
    const name = REQUIREMENT_NAME_RE.exec(code);
    if (!name) continue;
    const rest = code.slice(name[0].length);
    // The name must end here, and the spec stays on one line.
    if (REQUIREMENT_NAME_CHAR_RE.test(rest) || LINE_BREAK_RE.test(rest)) {
      continue;
    }
    const rawSpec = rest.trim();
    if (rawSpec && !/^[!<>=~^v\d]/.test(rawSpec)) continue;
    const parsed = parsePythonConstraint(rawSpec);
    const { major, resolvedVersion } = resolveVersionWithLock(parsed, () =>
      locks.getPythonLockVersion(manifestDir),
    );
    if (major !== undefined) {
      return [
        {
          key: 'posthog-python',
          packageName: 'posthog',
          major,
          resolvedVersion,
          constraintKind: parsed.constraintKind,
          rawSpec: sanitizeRawSpec(rawSpec || 'posthog', major),
          source: relPath,
        },
      ];
    }
  }
  return [];
}

const MAX_SECTION_NAME_LENGTH = 256;
const POETRY_DEP_SECTION_RE =
  /^tool\.poetry\.(?:dev-dependencies|dependencies|group\.[^.]+\.dependencies)$/;
const ARRAY_DEP_SECTION_RE =
  /^(?:project\.optional-dependencies|dependency-groups|tool\.pdm\.dev-dependencies|tool\.uv\.dev-dependencies|tool\.hatch\.envs\.[^.]+\.dependencies)$/;
// Non-backtracking quoted Python requirement match; boundary & markers validated in JS.
const PYPROJECT_QUOTED_POSTHOG_RE =
  /["'][ \t]*posthog(?:\[[^"'\r\n\]]*\])?([^"'\r\n]*)["']/gi;

function extractQuotedPosthogSpec(line: string): string | undefined {
  PYPROJECT_QUOTED_POSTHOG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PYPROJECT_QUOTED_POSTHOG_RE.exec(line)) !== null) {
    const beforeMarker = match[1].split(';', 1)[0].trim();
    if (beforeMarker && !/^[!<>=~^]/.test(beforeMarker)) continue;
    return beforeMarker;
  }
  return undefined;
}

function parseTomlStringLiteral(
  text: string,
  start: number,
  allowSingleQuotes: boolean,
): { value: string; next: number } | null {
  const quote = text[start];
  if (quote !== '"' && (!allowSingleQuotes || quote !== "'")) return null;
  let i = start + 1;
  let value = '';
  while (i < text.length) {
    const ch = text[i];
    if (quote === '"' && ch === '\\' && i + 1 < text.length) {
      value += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === quote) {
      return { value, next: i + 1 };
    }
    value += ch;
    i++;
  }
  return null;
}

/** Skip one TOML value; returns the end index, or `null` on a depth-zero `}`. */
function skipTomlBalancedValue(text: string, start: number): number | null {
  let i = start;
  let braceDepth = 0;
  let bracketDepth = 0;
  let inQuote: '"' | "'" | null = null;
  while (i < text.length) {
    const ch = text[i];
    if (inQuote) {
      if (inQuote === '"' && ch === '\\' && i + 1 < text.length) {
        i += 2;
        continue;
      }
      if (ch === inQuote) inQuote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === '{') {
      braceDepth++;
    } else if (ch === '}') {
      if (braceDepth === 0 && bracketDepth === 0) {
        return i === start ? null : i;
      }
      braceDepth = Math.max(0, braceDepth - 1);
    } else if (ch === '[') {
      bracketDepth++;
    } else if (ch === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (ch === ',' && braceDepth === 0 && bracketDepth === 0) {
      return i;
    }
    i++;
  }
  return i;
}

function parseTomlInlineTable(
  rhs: string,
  allowSingleQuotes: boolean,
): Record<string, string> | null {
  if (!rhs.startsWith('{') || !rhs.endsWith('}')) return null;
  const body = rhs.slice(1, -1);
  const fields: Record<string, string> = {};
  let i = 0;
  const len = body.length;
  while (i < len) {
    while (
      i < len &&
      (body[i] === ' ' || body[i] === '\t' || body[i] === ',')
    ) {
      i++;
    }
    if (i >= len) break;
    const keyStart = i;
    while (i < len && /[A-Za-z0-9_-]/.test(body[i])) i++;
    const key = body.slice(keyStart, i);
    while (i < len && (body[i] === ' ' || body[i] === '\t')) i++;
    if (!key || i >= len || body[i] !== '=') {
      const next = skipTomlBalancedValue(body, i);
      if (next === null) return null;
      i = Math.max(i + 1, next);
      continue;
    }
    i++;
    while (i < len && (body[i] === ' ' || body[i] === '\t')) i++;
    const str = parseTomlStringLiteral(body, i, allowSingleQuotes);
    if (str) {
      fields[key] = str.value;
      i = str.next;
    } else {
      const next = skipTomlBalancedValue(body, i);
      if (next === null) return null;
      i = Math.max(i + 1, next);
    }
  }
  return fields;
}

function parseTomlKeyAssignment(
  code: string,
  allowSingleQuotes: boolean,
): {
  key: string;
  stringValue?: string;
  table?: Record<string, string>;
} | null {
  const eqIdx = code.indexOf('=');
  if (eqIdx <= 0) return null;
  const key = code.slice(0, eqIdx).trim();
  if (!/^[A-Za-z0-9_-]+$/.test(key)) return null;
  const rhs = code.slice(eqIdx + 1).trim();
  const str = parseTomlStringLiteral(rhs, 0, allowSingleQuotes);
  if (str && str.next === rhs.length) {
    return { key, stringValue: str.value };
  }
  if (rhs.startsWith('{')) {
    const table = parseTomlInlineTable(rhs, allowSingleQuotes);
    if (table) return { key, table };
  }
  return null;
}

function parsePyprojectToml(
  fullPath: string,
  relPath: string,
  locks: LockfileReader,
): DetectedPostHogSdk[] {
  const content = safeReadFile(fullPath);
  if (!content) return [];
  const manifestDir = path.dirname(fullPath);

  let inPoetrySection = false;
  let inArraySection = false;
  let inDepsArray = false;
  let arrayDepth = 0;
  let rawSpec: string | undefined;
  let matched = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const code = stripLineComment(rawLine, '#').trim();
    if (!code) continue;

    const header = code.match(/^\[([^\]]+)\]$/);
    if (header) {
      // Classify once per header; an oversized name matches no section.
      const section =
        header[1].length > MAX_SECTION_NAME_LENGTH
          ? ''
          : header[1].trim().toLowerCase();
      inPoetrySection = POETRY_DEP_SECTION_RE.test(section);
      inArraySection = ARRAY_DEP_SECTION_RE.test(section);
      inDepsArray = false;
      arrayDepth = 0;
      continue;
    }

    if (inPoetrySection) {
      const assignment = parseTomlKeyAssignment(code, true);
      if (assignment && assignment.key.toLowerCase() === 'posthog') {
        const spec = assignment.stringValue ?? assignment.table?.version;
        if (spec !== undefined) {
          rawSpec = spec.trim();
          matched = true;
          break;
        }
      }
      continue;
    }

    const startsDepArray =
      /^(?:[\w.-]*dependencies)\s*=\s*\[/i.test(code) ||
      (inArraySection && /^[\w.-]+\s*=\s*\[/.test(code));
    if (startsDepArray) {
      inDepsArray = true;
    }

    if (inDepsArray) {
      const quotedSpec = extractQuotedPosthogSpec(code);
      if (quotedSpec !== undefined) {
        rawSpec = quotedSpec;
        matched = true;
        break;
      }
      const noQuotes = code.replace(/"[^"]*"|'[^']*'/g, '');
      arrayDepth +=
        (noQuotes.match(/\[/g)?.length ?? 0) -
        (noQuotes.match(/\]/g)?.length ?? 0);
      if (arrayDepth <= 0) {
        inDepsArray = false;
        arrayDepth = 0;
      }
    }
  }

  if (!matched) return [];

  const parsed = parsePythonConstraint(rawSpec ?? '');
  const { major, resolvedVersion } = resolveVersionWithLock(parsed, () =>
    locks.getPythonLockVersion(manifestDir),
  );
  if (major === undefined) return [];
  return [
    {
      key: 'posthog-python',
      packageName: 'posthog',
      major,
      resolvedVersion,
      constraintKind: parsed.constraintKind,
      rawSpec: sanitizeRawSpec(rawSpec || 'posthog', major),
      source: relPath,
    },
  ];
}

function parseGoMod(fullPath: string, relPath: string): DetectedPostHogSdk[] {
  const content = safeReadFile(fullPath);
  if (!content) return [];
  let inRequireBlock = false;
  for (const raw of content.split(/\r?\n/)) {
    const code = stripLineComment(raw, '//').trim();
    if (!code) continue;
    if (code === ')') {
      inRequireBlock = false;
      continue;
    }
    if (code.endsWith('(')) {
      inRequireBlock = code.startsWith('require');
      continue;
    }
    const line = inRequireBlock
      ? code
      : code.startsWith('require ')
      ? code.slice('require '.length).trim()
      : '';
    if (!line) continue;
    const m = line.match(
      /^(github\.com\/posthog\/posthog-go(?:\/v(\d+))?)[ \t]+(v(\d+)\.[A-Za-z0-9._+-]+)/,
    );
    if (!m) continue;
    const major = m[2] ? Number(m[2]) : Number(m[4]);
    return [
      {
        key: 'posthog-go',
        packageName: m[1],
        major,
        resolvedVersion: sanitizeResolvedVersion(m[3].replace(/^v/, '')),
        constraintKind: 'range',
        rawSpec: sanitizeRawSpec(`${m[1]} ${m[3]}`, major),
        source: relPath,
      },
    ];
  }
  return [];
}

function parseCargoConstraint(rawSpec: string): {
  major?: number;
  resolvedVersion?: string;
  constraintKind: SdkConstraintKind;
} {
  const cleaned = rawSpec.trim();
  if (cleaned.length > MAX_SEMVER_SPEC_LENGTH) {
    return { constraintKind: 'unknown' };
  }
  const eq = cleaned.match(/^=\s*(\d+\.\d+\.\d+.*)$/);
  if (eq) {
    return {
      major: Number(eq[1].split('.')[0]),
      resolvedVersion: sanitizeResolvedVersion(eq[1]),
      constraintKind: 'pinned',
    };
  }
  const parsed = parseSemverConstraint(cleaned);
  return {
    major: parsed.major,
    constraintKind: 'range',
  };
}

function parseCargoToml(
  fullPath: string,
  relPath: string,
  locks: LockfileReader,
): DetectedPostHogSdk[] {
  const content = safeReadFile(fullPath);
  if (!content) return [];
  const manifestDir = path.dirname(fullPath);
  let section = '';
  let subtableCrate: string | undefined;
  for (const raw of content.split(/\r?\n/)) {
    const code = stripLineComment(raw, '#').trim();
    if (!code) continue;
    const header = code.match(/^\[([^\]]+)\]$/);
    if (header) {
      section = header[1].trim();
      const subMatch = section.match(
        /^(?:workspace\.)?(?:dev-)?dependencies\.(posthog(?:-rs)?)$/,
      );
      subtableCrate = subMatch?.[1];
      continue;
    }
    if (subtableCrate) {
      const crateName = subtableCrate;
      const verMatch = code.match(/^version\s*=\s*"([^"]+)"/);
      if (!verMatch) continue;
      const parsed = parseCargoConstraint(verMatch[1]);
      const { major, resolvedVersion } = resolveVersionWithLock(parsed, () =>
        locks.getCargoLockVersion(manifestDir, crateName),
      );
      if (major !== undefined) {
        return [
          {
            key: 'posthog-rust',
            packageName: crateName,
            major,
            resolvedVersion,
            constraintKind: parsed.constraintKind,
            rawSpec: sanitizeRawSpec(verMatch[1], major),
            source: relPath,
          },
        ];
      }
      continue;
    }
    const inDeps =
      section === 'dependencies' ||
      section === 'dev-dependencies' ||
      section === 'workspace.dependencies' ||
      section.endsWith('.dependencies');
    if (!inDeps) continue;

    const assignment = parseTomlKeyAssignment(code, false);
    if (!assignment) continue;

    let crateName: string | undefined;
    let rawSpec: string | undefined;
    if (assignment.key === 'posthog' || assignment.key === 'posthog-rs') {
      // Case 1: direct dep `posthog-rs = "0.29.0"` or `posthog = "1.0.0"` or `{ version = "..." }`
      crateName = assignment.key;
      rawSpec = assignment.stringValue ?? assignment.table?.version;
    } else if (
      assignment.table &&
      (assignment.table.package === 'posthog' ||
        assignment.table.package === 'posthog-rs')
    ) {
      // Case 2: renamed dep `my_ph = { package = "posthog-rs", version = "=0.25.0" }`
      crateName = assignment.table.package;
      rawSpec = assignment.table.version;
    }
    if (!crateName || !rawSpec) continue;

    const parsed = parseCargoConstraint(rawSpec);
    const { major, resolvedVersion } = resolveVersionWithLock(parsed, () =>
      locks.getCargoLockVersion(manifestDir, crateName),
    );
    if (major === undefined) continue;

    return [
      {
        key: 'posthog-rust',
        packageName: crateName,
        major,
        resolvedVersion,
        constraintKind: parsed.constraintKind,
        rawSpec: sanitizeRawSpec(rawSpec, major),
        source: relPath,
      },
    ];
  }
  return [];
}

function parseMobileManifests(
  name: string,
  fullPath: string,
  relPath: string,
): DetectedPostHogSdk[] {
  const content = safeReadFile(fullPath);
  if (!content) return [];
  if (name === 'pubspec.yaml') {
    const cleaned = stripLineComments(content, '#');
    const m = cleaned.match(
      /^[ \t]*posthog_flutter[ \t]*:[ \t]*['"]?([^\s'"#]+)/m,
    );
    if (!m) return [];
    const parsed = parseSemverConstraint(m[1]);
    if (parsed.major === undefined) return [];
    return [
      {
        key: 'posthog-flutter',
        packageName: 'posthog_flutter',
        major: parsed.major,
        resolvedVersion: parsed.resolvedVersion,
        constraintKind: parsed.constraintKind,
        rawSpec: sanitizeRawSpec(m[1], parsed.major),
        source: relPath,
      },
    ];
  }
  if (name === 'build.gradle' || name === 'build.gradle.kts') {
    const cleaned = stripLineComments(stripBlockComments(content), '//');
    const m = cleaned.match(
      /com\.posthog:posthog-android:((?:[[(][^\s'"[\]()]*[\])],?)+|[^\s'")]+)/,
    );
    if (!m) return [];
    const parsed = parseSemverConstraint(m[1]);
    if (parsed.major === undefined) return [];
    return [
      {
        key: 'posthog-android',
        packageName: 'posthog-android',
        major: parsed.major,
        resolvedVersion: parsed.resolvedVersion,
        constraintKind: parsed.constraintKind,
        rawSpec: sanitizeRawSpec(m[1], parsed.major),
        source: relPath,
      },
    ];
  }
  if (name === 'Podfile') {
    const cleaned = stripLineComments(content, '#');
    const m = cleaned.match(/pod\s+['"]PostHog['"]\s*,\s*['"]([^'"]+)['"]/);
    if (!m) return [];
    const parsed = parseSemverConstraint(m[1]);
    if (parsed.major === undefined) return [];
    return [
      {
        key: 'posthog-ios',
        packageName: 'PostHog',
        major: parsed.major,
        resolvedVersion: parsed.resolvedVersion,
        constraintKind: parsed.constraintKind,
        rawSpec: sanitizeRawSpec(m[1], parsed.major),
        source: relPath,
      },
    ];
  }
  return [];
}

/**
 * Walk `installDir` boundedly once without following symlinks, returning both
 * exact-major SDK entries and whether any PostHog SDK package (including JS/RN)
 * is declared.
 */
export function scanPostHogSdksWithPresence(
  installDir: string,
  maxDepth = MAX_SCAN_DEPTH,
  rootDir?: string,
): { sdks: DetectedPostHogSdk[]; hasAnySdk: boolean } {
  const found: DetectedPostHogSdk[] = [];
  const seenKeys = new Set<string>();
  let hasAnySdk = false;

  let realRoot: string | undefined;
  try {
    realRoot = fs.realpathSync(installDir);
    if (rootDir) {
      // Only widen the lockfile boundary to a real ancestor-or-equal of installDir.
      try {
        const realBound = fs.realpathSync(rootDir);
        if (
          realRoot === realBound ||
          realRoot.startsWith(realBound + path.sep)
        ) {
          realRoot = realBound;
        }
      } catch {
        // Unresolvable rootDir: keep installDir as the boundary.
      }
    }
  } catch {
    realRoot = undefined;
  }
  const locks = createLockfileReader(realRoot);

  const record = (items: DetectedPostHogSdk[]) => {
    for (const item of items) {
      hasAnySdk = true;
      const dedupeKey = `${item.key}:${item.source}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);
      found.push(item);
    }
  };

  walkProjectFiles(
    installDir,
    (name, fullPath) => {
      const relPath = toPromptSafeRelativePath(installDir, fullPath);
      if (name === 'package.json') {
        const parsedPkg = parsePackageJsonSdks(fullPath, relPath, locks);
        if (parsedPkg.hasAnyNpmSdk) hasAnySdk = true;
        record(parsedPkg.sdks);
      } else if (/^requirements.*\.txt$/.test(name)) {
        record(parseRequirementsTxt(fullPath, relPath, locks));
      } else if (name === 'pyproject.toml') {
        record(parsePyprojectToml(fullPath, relPath, locks));
      } else if (name === 'go.mod') {
        record(parseGoMod(fullPath, relPath));
      } else if (name === 'Cargo.toml') {
        record(parseCargoToml(fullPath, relPath, locks));
      } else if (
        name === 'pubspec.yaml' ||
        name === 'build.gradle' ||
        name === 'build.gradle.kts' ||
        name === 'Podfile'
      ) {
        record(parseMobileManifests(name, fullPath, relPath));
      }
    },
    maxDepth,
    { followSymlinks: false },
  );

  return { sdks: found, hasAnySdk };
}

/**
 * Walk `installDir` boundedly and detect declared PostHog SDKs along with
 * their major version and constraint kind (`pinned` vs `range`).
 */
export function scanPostHogSdks(
  installDir: string,
  maxDepth = MAX_SCAN_DEPTH,
  rootDir?: string,
): DetectedPostHogSdk[] {
  return scanPostHogSdksWithPresence(installDir, maxDepth, rootDir).sdks;
}

/** Store detected SDKs in session frameworkContext and return both SDKs and package presence. */
export function recordPostHogSdksWithPresence(
  ctx: Pick<ProgramReadyContext, 'session' | 'setFrameworkContext'>,
  installDir: string = ctx.session.installDir,
  rootDir?: string,
): { sdks: DetectedPostHogSdk[]; hasAnySdk: boolean } {
  const result = scanPostHogSdksWithPresence(
    installDir,
    MAX_SCAN_DEPTH,
    rootDir,
  );
  ctx.setFrameworkContext(POSTHOG_SDKS_KEY, result.sdks);
  ctx.setFrameworkContext(POSTHOG_SDKS_DIR_KEY, installDir);
  return result;
}

/** Store detected SDKs in session frameworkContext. */
export function recordPostHogSdks(
  ctx: Pick<ProgramReadyContext, 'session' | 'setFrameworkContext'>,
  installDir: string = ctx.session.installDir,
  rootDir?: string,
): DetectedPostHogSdk[] {
  return recordPostHogSdksWithPresence(ctx, installDir, rootDir).sdks;
}

/** Record SDKs after `onReady`/`ciPreRun` when `config.sdkSupport` is set and the current dir has not been scanned yet. */
export function recordPostHogSdksIfNeeded(
  config: Pick<ProgramConfig, 'sdkSupport'> | undefined,
  ctx: Pick<ProgramReadyContext, 'session' | 'setFrameworkContext'>,
  rootDir?: string,
): void {
  if (!config?.sdkSupport) return;
  const { session } = ctx;
  const alreadyRecordedForDir =
    Array.isArray(session.frameworkContext[POSTHOG_SDKS_KEY]) &&
    session.frameworkContext[POSTHOG_SDKS_DIR_KEY] === session.installDir;
  if (alreadyRecordedForDir) return;
  recordPostHogSdks(ctx, session.installDir, rootDir);
}

/** Read detected PostHog SDKs from a session. */
export function getPostHogSdks(
  session: Pick<ProgramSession, 'frameworkContext'>,
): DetectedPostHogSdk[] {
  const raw = session.frameworkContext[POSTHOG_SDKS_KEY];
  return Array.isArray(raw) ? (raw as DetectedPostHogSdk[]) : [];
}

/**
 * Concise project facts describing installed PostHog SDKs and pins.
 * Returns empty on greenfield projects so greenfield prompts stay unchanged.
 */
export function posthogSdkFacts(
  session: Pick<ProgramSession, 'frameworkContext'>,
): string[] {
  const sdks = getPostHogSdks(session).slice(0, MAX_SDK_FACTS);
  return sdks.map((sdk) => {
    const source = sanitizeReportedPath(sdk.source);
    const rawSpec = sanitizeRawSpec(sdk.rawSpec, sdk.major);
    const resolvedVersion = sanitizeResolvedVersion(sdk.resolvedVersion);
    const versionPart = resolvedVersion
      ? `${sdk.packageName}==${resolvedVersion} (${rawSpec})`
      : `${sdk.packageName} (${rawSpec})`;
    const rawHidden = rawSpec === `${sdk.major}.x`;
    const pinAt = rawHidden && resolvedVersion ? resolvedVersion : rawSpec;
    const pinNote =
      sdk.constraintKind === 'pinned'
        ? rawHidden && !resolvedVersion
          ? `hard-pinned to an exact ${rawSpec} version that is not shown (read the manifest and leave the pin untouched; use major ${sdk.major} fallbacks or report required floor)`
          : `hard-pinned at ${pinAt} (preserve the pin unless bumped manually by user; use major ${sdk.major} fallbacks or report required floor)`
        : `range constraint on major ${sdk.major} (only bump within major ${sdk.major} if a feature requires a higher minimum floor)`;
    return `Existing PostHog SDK in ${source}: ${versionPart}, major ${sdk.major}, ${pinNote}. Stay on major ${sdk.major} and reuse the existing PostHog client.`;
  });
}

/** `posthogSdkFacts` filtered through Warlock input scanning so flagged manifest data never reaches prompts. */
export async function safePosthogSdkFacts(
  session: Pick<ProgramSession, 'frameworkContext'>,
): Promise<string[]> {
  const facts = posthogSdkFacts(session);
  if (facts.length === 0) return [];
  try {
    const kept: string[] = [];
    for (const fact of facts) {
      if (!(await isFlaggedInput(fact))) kept.push(fact);
    }
    return kept;
  } catch (error) {
    logToFile('[detection] SDK fact scan failed:', error);
    return [];
  }
}
