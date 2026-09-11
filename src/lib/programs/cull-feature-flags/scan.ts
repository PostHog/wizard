import * as path from 'path';
import {
  boundedGlob,
  GLOB_DEADLINE_MS,
  readProjectFile,
} from '@utils/bounded-fs';

export interface FlagCallSite {
  key: string;
  file: string;
  line: number;
  api: string;
}

export interface FlagDynamicSite {
  file: string;
  line: number;
  api: string;
}

export interface FlagMentionSite {
  key: string;
  file: string;
  line: number;
}

export interface FlagScanResult {
  callSites: FlagCallSite[];
  dynamicSites: FlagDynamicSite[];
  /** Known keys that appear as a quoted string somewhere they are not evaluated (comments, config). */
  mentionSites: FlagMentionSite[];
  /** `getAllFlags` / `getAllFlagsAndPayloads` present, so every flag may be read without a literal key. */
  usesBulkEvaluation: boolean;
  /** Files that are a Next.js convention entry or imported by another scanned file. */
  reachableFiles: string[];
  filesScanned: number;
  truncated: boolean;
}

const SOURCE_GLOB = '**/*.{ts,tsx,js,jsx,mjs,cjs}';
const SCAN_FILE_LIMIT = 2000;
const MAX_SOURCE_FILE_BYTES = 512 * 1024;

const FLAG_APIS = [
  'isFeatureEnabled',
  'getFeatureFlag',
  'getFeatureFlagPayload',
  'getFeatureFlagResult',
  'useFeatureFlagEnabled',
  'useFeatureFlagVariantKey',
  'useFeatureFlagPayload',
];
const FLAG_API_ALTERNATION = FLAG_APIS.join('|');
const LITERAL_CALL_RE = new RegExp(
  `\\b(${FLAG_API_ALTERNATION})\\s*\\(\\s*(['"\`])([^'"\`]+)\\2`,
  'g',
);
const DYNAMIC_CALL_RE = new RegExp(
  `\\b(${FLAG_API_ALTERNATION})\\s*\\(\\s*(?!['"\`])[^)\\s]`,
  'g',
);
const LITERAL_JSX_RE =
  /<PostHogFeature\b[^>]*?\bflag=(?:"([^"]+)"|'([^']+)'|\{\s*['"]([^'"]+)['"]\s*\})/g;
const DYNAMIC_JSX_RE = /<PostHogFeature\b[^>]*?\bflag=\{\s*(?!['"])[^}\s]/g;
const BULK_RE = /\b(getAllFlags|getAllFlagsAndPayloads)\s*\(/;
const PREFILTER = /FeatureFlag|isFeatureEnabled|PostHogFeature|getAllFlags/;
const IMPORT_SPECIFIER_RE =
  /(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
const NEXT_ENTRY_FILE_RE =
  /(?:^|\/)(?:app\/.*\/?(?:page|layout|route|loading|error|not-found|template|default|global-error|sitemap|robots|manifest|opengraph-image|twitter-image|icon|apple-icon)|pages\/.*|middleware|proxy|instrumentation(?:-client)?|next\.config)\.(?:tsx?|[mc]?jsx?)$/;

function stripComments(lines: string[]): string[] {
  let isInsideBlockComment = false;
  return lines.map((line) => {
    let code = '';
    let index = 0;
    while (index < line.length) {
      if (isInsideBlockComment) {
        const end = line.indexOf('*/', index);
        if (end === -1) return code;
        isInsideBlockComment = false;
        index = end + 2;
        continue;
      }
      const blockStart = line.indexOf('/*', index);
      const lineStart = line.indexOf('//', index);
      const hasLineComment =
        lineStart !== -1 && (blockStart === -1 || lineStart < blockStart);
      if (hasLineComment) return code + line.slice(index, lineStart);
      if (blockStart === -1) return code + line.slice(index);
      code += line.slice(index, blockStart);
      isInsideBlockComment = true;
      index = blockStart + 2;
    }
    return code;
  });
}

function jsxKey(match: RegExpExecArray): string {
  return match[1] ?? match[2] ?? match[3];
}

function collectSites(
  file: string,
  codeLines: string[],
  result: FlagScanResult,
): void {
  codeLines.forEach((code, lineIndex) => {
    const line = lineIndex + 1;
    for (const match of code.matchAll(LITERAL_CALL_RE)) {
      result.callSites.push({ key: match[3], file, line, api: match[1] });
    }
    for (const match of code.matchAll(DYNAMIC_CALL_RE)) {
      result.dynamicSites.push({ file, line, api: match[1] });
    }
    for (const match of code.matchAll(LITERAL_JSX_RE)) {
      result.callSites.push({
        key: jsxKey(match),
        file,
        line,
        api: 'PostHogFeature',
      });
    }
    if (DYNAMIC_JSX_RE.test(code)) {
      result.dynamicSites.push({ file, line, api: 'PostHogFeature' });
    }
    DYNAMIC_JSX_RE.lastIndex = 0;
    if (BULK_RE.test(code)) result.usesBulkEvaluation = true;
  });
}

// A file that called getAllFlags reads keys out of the result object, so a
// quoted key there is an evaluation, not a stray mention.
function collectMentions(
  file: string,
  rawLines: string[],
  codeLines: string[],
  knownKeys: readonly string[],
  callSitesInFile: FlagCallSite[],
  result: FlagScanResult,
): void {
  if (knownKeys.length === 0) return;
  const hasBulkCall = codeLines.some((code) => BULK_RE.test(code));
  const evaluatedOnLine = new Set(
    callSitesInFile.map((site) => `${site.line}:${site.key}`),
  );
  rawLines.forEach((raw, lineIndex) => {
    const line = lineIndex + 1;
    for (const key of knownKeys) {
      if (evaluatedOnLine.has(`${line}:${key}`)) continue;
      if (!raw.includes(key)) continue;
      const quoted = new RegExp(`['"\`]${escapeRegExp(key)}['"\`]`);
      if (!quoted.test(raw)) continue;
      const isBulkLookup = hasBulkCall && quoted.test(codeLines[lineIndex]);
      if (isBulkLookup) {
        result.callSites.push({ key, file, line, api: 'getAllFlags' });
        continue;
      }
      result.mentionSites.push({ key, file, line });
    }
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function importedModuleNames(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(IMPORT_SPECIFIER_RE)) {
    const specifier = match[1].replace(/\?.*$/, '');
    const segments = specifier.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (!last) continue;
    names.push(last.replace(/\.(?:tsx?|[mc]?jsx?)$/, ''));
  }
  return names;
}

function isReachable(file: string, importedNames: Set<string>): boolean {
  if (NEXT_ENTRY_FILE_RE.test(file)) return true;
  const baseName = path.basename(file).replace(/\.(?:tsx?|[mc]?jsx?)$/, '');
  if (importedNames.has(baseName)) return true;
  if (baseName !== 'index') return false;
  return importedNames.has(path.basename(path.dirname(file)));
}

/**
 * Deterministic scan of a JS/TS project for PostHog feature flag evaluation
 * sites. Comments are stripped before matching; `knownKeys` (the project's
 * flags from PostHog) turn quoted-but-unevaluated keys into mention sites.
 */
export async function scanFlagCallSites(
  installDir: string,
  knownKeys: readonly string[] = [],
): Promise<FlagScanResult> {
  const startedAt = Date.now();
  const files = await boundedGlob(SOURCE_GLOB, {
    cwd: installDir,
    limit: SCAN_FILE_LIMIT,
  });
  const elapsedMs = Date.now() - startedAt;
  const result: FlagScanResult = {
    callSites: [],
    dynamicSites: [],
    mentionSites: [],
    usesBulkEvaluation: false,
    reachableFiles: [],
    filesScanned: 0,
    truncated: files.length >= SCAN_FILE_LIMIT || elapsedMs >= GLOB_DEADLINE_MS,
  };
  const importedNames = new Set<string>();
  const sortedFiles = [...files].sort();

  for (const file of sortedFiles) {
    const source = readProjectFile(
      path.join(installDir, file),
      MAX_SOURCE_FILE_BYTES,
    );
    if (source === null) continue;
    result.filesScanned += 1;
    for (const name of importedModuleNames(source)) importedNames.add(name);
    if (
      !PREFILTER.test(source) &&
      !knownKeys.some((key) => source.includes(key))
    )
      continue;
    const rawLines = source.split('\n');
    const codeLines = stripComments(rawLines);
    const before = result.callSites.length;
    collectSites(file, codeLines, result);
    collectMentions(
      file,
      rawLines,
      codeLines,
      knownKeys,
      result.callSites.slice(before),
      result,
    );
  }

  result.reachableFiles = sortedFiles.filter((file) =>
    isReachable(file, importedNames),
  );
  return result;
}
