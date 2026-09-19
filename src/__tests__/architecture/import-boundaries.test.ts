import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

export type Surface = 'env' | 'store' | 'agent' | 'tui' | 'cli' | 'harness';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

const SURFACE_RULES: ReadonlyArray<readonly [Surface, (p: string) => boolean]> =
  [
    ['env', (p) => p === 'src/env.ts'],
    ['agent', (p) => p.startsWith('src/agent/')],
    ['tui', (p) => p.startsWith('src/tui/')],
    ['cli', (p) => p === 'bin.ts' || p.startsWith('src/cli/')],
    [
      'harness',
      (p) => p.startsWith('e2e-harness/') || p.startsWith('scripts/'),
    ],
  ];

export function classifySurface(relPath: string): Surface {
  const p = relPath.split(path.sep).join('/');
  for (const [surface, matches] of SURFACE_RULES) {
    if (matches(p)) return surface;
  }
  return 'store';
}

export const ALLOWED_IMPORTS: Record<
  Exclude<Surface, 'harness'>,
  readonly Surface[]
> = {
  env: [],
  store: ['env', 'store'],
  agent: ['env', 'store', 'agent'],
  tui: ['env', 'store', 'tui'],
  cli: ['env', 'store', 'agent', 'tui', 'cli'],
};

const TUI_ONLY_PACKAGES = ['ink', 'react', '@inkjs/ui', 'ink-testing-library'];

const SKIP_DIRS = new Set([
  '__tests__',
  '__mocks__',
  '__fixtures__',
  '__snapshots__',
  'node_modules',
  'dist',
  'coverage',
]);

const SPECIFIER_PATTERNS = [
  /import\s+(?:type\s+)?[^'"]*?from\s*['"]([^'"]+)['"]/g,
  /import\s*['"]([^'"]+)['"]/g,
  /export\s+(?:type\s+)?[^'"]*?from\s*['"]([^'"]+)['"]/g,
  /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  /require\(\s*['"]([^'"]+)['"]\s*\)/g,
];

const REGEX_PRECEDERS = new Set([
  '\n',
  '(',
  ')',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '^',
  '~',
  '<',
  '>',
]);

function endOfString(source: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source[i] === quote) return i + 1;
    i++;
  }
  return source.length;
}

function endOfRegex(source: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '\n') return start + 1;
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) return i + 1;
    i++;
  }
  return source.length;
}

function stripComments(source: string): string {
  let out = '';
  let prev = '\n';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/'))
        i++;
      i += 2;
      out += ' ';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const end = endOfString(source, i, c);
      out += source.slice(i, end);
      prev = c;
      i = end;
      continue;
    }
    if (c === '/' && REGEX_PRECEDERS.has(prev)) {
      const end = endOfRegex(source, i);
      out += source.slice(i, end);
      prev = '/';
      i = end;
      continue;
    }
    out += c;
    if (c === '\n' || !/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

function toRepoRelative(abs: string): string {
  return path.relative(REPO_ROOT, abs).split(path.sep).join('/');
}

function isFile(abs: string): boolean {
  return fs.statSync(abs, { throwIfNoEntry: false })?.isFile() ?? false;
}

function collectFiles(absDir: string, into: string[]): void {
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectFiles(abs, into);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.d\.ts$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name))
      continue;
    into.push(toRepoRelative(abs));
  }
}

function loadAliases(): ReadonlyArray<readonly [string, string]> {
  const tsconfig = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'tsconfig.build.json'), 'utf8'),
  ) as { compilerOptions?: { paths?: Record<string, string[]> } };
  return Object.entries(tsconfig.compilerOptions?.paths ?? {}).map(
    ([pattern, targets]) => [pattern, targets[0]] as const,
  );
}

function aliasTarget(
  spec: string,
  aliases: ReadonlyArray<readonly [string, string]>,
): string | null {
  for (const [pattern, target] of aliases) {
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      if (spec.startsWith(prefix)) {
        return path.resolve(
          REPO_ROOT,
          target.slice(0, -1) + spec.slice(prefix.length),
        );
      }
    } else if (spec === pattern) {
      return path.resolve(REPO_ROOT, target);
    }
  }
  return null;
}

function probe(base: string): string | null {
  const candidates: string[] = [];
  if (base.endsWith('.js')) {
    const stem = base.slice(0, -3);
    candidates.push(`${stem}.ts`, `${stem}.tsx`);
  }
  candidates.push(
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    base,
  );
  return candidates.find(isFile) ?? null;
}

function specifiersIn(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match !== null) {
      found.add(match[1]);
      match = pattern.exec(text);
    }
  }
  return [...found];
}

type Analysis = {
  files: string[];
  edges: string[];
  violations: ReadonlyArray<{ key: string; rule: string }>;
  unresolved: string[];
};

function analyze(): Analysis {
  const files: string[] = ['bin.ts'];
  collectFiles(path.join(REPO_ROOT, 'src'), files);
  files.sort();

  const aliases = loadAliases();
  const edges = new Set<string>();
  const violations = new Map<string, string>();
  const unresolved = new Set<string>();

  for (const file of files) {
    const text = stripComments(
      fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'),
    );
    const from = classifySurface(file);
    const allowed = from === 'harness' ? [] : ALLOWED_IMPORTS[from];

    for (const spec of specifiersIn(text)) {
      const base = spec.startsWith('.')
        ? path.resolve(REPO_ROOT, path.dirname(file), spec)
        : aliasTarget(spec, aliases);

      if (base === null) {
        const tuiOnly =
          TUI_ONLY_PACKAGES.includes(spec) || spec.startsWith('react/');
        if (tuiOnly && from !== 'tui') {
          violations.set(`${file} -> pkg:${spec}`, 'ink-outside-tui');
        }
        continue;
      }

      const resolved = probe(base);
      if (resolved === null) {
        unresolved.add(`${file} -> ${spec}`);
        continue;
      }

      const target = toRepoRelative(resolved);
      const key = `${file} -> ${target}`;
      edges.add(key);

      const to = classifySurface(target);
      if (to === 'harness') violations.set(key, 'harness');
      else if (!allowed.includes(to))
        violations.set(key, `matrix:${from}->${to}`);
    }
  }

  return {
    files,
    edges: [...edges].sort(),
    violations: [...violations]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, rule]) => ({ key, rule })),
    unresolved: [...unresolved].sort(),
  };
}

const analysis = analyze();

const known = (
  JSON.parse(
    fs.readFileSync(path.join(HERE, 'known-violations.json'), 'utf8'),
  ) as { violations: string[] }
).violations;

if (process.env.PRINT_VIOLATIONS) {
  const byRule = new Map<string, number>();
  const byImporter = new Map<string, number>();
  for (const { key, rule } of analysis.violations) {
    byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
    const file = key.split(' -> ')[0];
    byImporter.set(file, (byImporter.get(file) ?? 0) + 1);
  }
  const lines = [
    `files scanned: ${analysis.files.length}`,
    `edges: ${analysis.edges.length}`,
    `violations: ${analysis.violations.length}`,
    `unresolved: ${analysis.unresolved.length}`,
    ...analysis.unresolved.map((u) => `  unresolved: ${u}`),
    ...[...byRule]
      .sort((a, b) => b[1] - a[1])
      .map(([rule, count]) => `  ${rule}: ${count}`),
    'top importers:',
    ...[...byImporter]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([file, count]) => `  ${file}: ${count}`),
  ];
  process.stderr.write(`${lines.join('\n')}\n`);
  process.stderr.write(
    `${JSON.stringify(
      { violations: analysis.violations.map((v) => v.key) },
      null,
      2,
    )}\n`,
  );
}

describe('import boundaries', () => {
  it('resolves every internal specifier', () => {
    expect(analysis.unresolved).toEqual([]);
  });

  it('introduces no violation outside known-violations.json', () => {
    const knownSet = new Set(known);
    const added = analysis.violations
      .filter(({ key }) => !knownSet.has(key))
      .map(({ key, rule }) => `${key}  [${rule}]`);
    expect(added).toEqual([]);
  });

  it('keeps known-violations.json free of stale entries', () => {
    const current = new Set(analysis.violations.map((v) => v.key));
    const stale = known.filter((key) => !current.has(key));
    expect(
      stale,
      'stale entries, delete them from known-violations.json',
    ).toEqual([]);
  });
});

describe('surface classification', () => {
  it('maps representative paths to their surface', () => {
    expect(classifySurface('src/env.ts')).toBe('env');
    expect(classifySurface('src/store/shared/analytics.ts')).toBe('store');
    expect(classifySurface('src/agent/agent-runner.ts')).toBe('agent');
    expect(classifySurface('src/tui/App.tsx')).toBe('tui');
    expect(classifySurface('bin.ts')).toBe('cli');
    expect(classifySurface('e2e-harness/e2e-profile.ts')).toBe('harness');
    expect(classifySurface('src/agent/tools/mcp.ts')).toBe('agent');
    expect(classifySurface('src/store/tools/tools.ts')).toBe('store');
    expect(classifySurface('src/tui/family-picker.tsx')).toBe('tui');
    expect(
      classifySurface('src/tui/programs/posthog-integration/content/index.tsx'),
    ).toBe('tui');
    expect(
      classifySurface('src/store/programs/posthog-integration/index.ts'),
    ).toBe('store');
  });
});
