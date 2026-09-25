import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

export type Surface =
  | 'env'
  | 'shared'
  | 'legacy'
  | 'agent'
  | 'programs'
  | 'tui'
  | 'cli';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

const SURFACE_RULES: ReadonlyArray<readonly [Surface, (p: string) => boolean]> =
  [
    ['env', (p) => p === 'src/env.ts'],
    ['shared', (p) => p.startsWith('src/shared/')],
    ['agent', (p) => p.startsWith('src/agent/')],
    ['programs', (p) => p.startsWith('src/programs/')],
    [
      'tui',
      (p) =>
        p.startsWith('src/ui/tui/') ||
        p === 'src/commands/factories/family-picker.tsx',
    ],
    [
      'cli',
      (p) =>
        p === 'bin.ts' ||
        p === 'src/wizard.ts' ||
        p.startsWith('src/commands/') ||
        p.startsWith('src/lib/runners/'),
    ],
  ];

export function classifySurface(relPath: string): Surface {
  const p = relPath.split(path.sep).join('/');
  for (const [surface, matches] of SURFACE_RULES) {
    if (matches(p)) return surface;
  }
  return 'legacy';
}

export const ALLOWED_IMPORTS: Record<Surface, readonly Surface[]> = {
  env: [],
  shared: ['env', 'shared'],
  legacy: ['env', 'shared', 'legacy', 'programs'],
  // B2 moves bindings and removes the agent's remaining ProgramId type imports.
  agent: ['env', 'shared', 'agent'],
  programs: ['env', 'shared', 'agent', 'programs'],
  tui: ['env', 'shared', 'legacy', 'programs', 'tui'],
  cli: ['env', 'shared', 'legacy', 'agent', 'programs', 'tui', 'cli'],
};

// The agent's public entries. Outside `src/agent`, an import into the agent
// must land on one of these; `types.ts` is type-only, so the TUI may take it.
const AGENT_VALUES_ENTRY = 'src/agent/index.ts';
const AGENT_TYPES_ENTRY = 'src/agent/types.ts';
const PROGRAMS_VALUES_ENTRY = 'src/programs/index.ts';
const PROGRAMS_TYPES_ENTRY = 'src/programs/types.ts';

/** The rule an edge breaks, or null when it is allowed. */
export function ruleFor(fromFile: string, toFile: string): string | null {
  const from = classifySurface(fromFile);
  const to = classifySurface(toFile);
  if (to === 'agent' && from !== 'agent') {
    const target = toFile.split(path.sep).join('/');
    if (target !== AGENT_VALUES_ENTRY && target !== AGENT_TYPES_ENTRY) {
      return 'agent-deep-import';
    }
    if (from === 'tui' && target !== AGENT_TYPES_ENTRY) {
      return `matrix:${from}->${to}`;
    }
    return null;
  }
  if (to === 'programs' && from !== 'programs') {
    const target = toFile.split(path.sep).join('/');
    if (target !== PROGRAMS_VALUES_ENTRY && target !== PROGRAMS_TYPES_ENTRY) {
      return 'programs-deep-import';
    }
  }
  return ALLOWED_IMPORTS[from].includes(to) ? null : `matrix:${from}->${to}`;
}

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

      const broken = ruleFor(file, target);
      if (broken !== null) violations.set(key, broken);
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
    expect(classifySurface('src/shared/utils/analytics.ts')).toBe('shared');
    expect(classifySurface('src/shared/errors/codes.ts')).toBe('shared');
    expect(classifySurface('src/agent/agent-runner.ts')).toBe('agent');
    expect(classifySurface('src/programs/program-registry.ts')).toBe(
      'programs',
    );
    expect(classifySurface('src/ui/tui/App.tsx')).toBe('tui');
    expect(classifySurface('src/ui/index.ts')).toBe('legacy');
    expect(classifySurface('src/steps/index.ts')).toBe('legacy');
    expect(classifySurface('bin.ts')).toBe('cli');
    expect(classifySurface('src/agent/tools/mcp.ts')).toBe('agent');
    expect(classifySurface('src/agent/tools/tools.ts')).toBe('agent');
    expect(classifySurface('src/commands/factories/family-picker.tsx')).toBe(
      'tui',
    );
    expect(
      classifySurface('src/ui/tui/decks/posthog-integration/index.tsx'),
    ).toBe('tui');
    expect(classifySurface('src/programs/posthog-integration/index.ts')).toBe(
      'programs',
    );
  });
});

describe('agent entry modules', () => {
  const rule = (from: string, to: string) => ruleFor(from, to);

  it('lets programs and cli code reach the agent through its entries only', () => {
    expect(rule('src/programs/audit/index.ts', 'src/agent/index.ts')).toBe(
      null,
    );
    expect(rule('src/programs/audit/index.ts', 'src/agent/types.ts')).toBe(
      null,
    );
    expect(rule('src/commands/skill.ts', 'src/agent/index.ts')).toBe(null);
    expect(
      rule('src/programs/audit/index.ts', 'src/agent/agent-runner.ts'),
    ).toBe('agent-deep-import');
    expect(rule('src/commands/skill.ts', 'src/agent/runner/index.ts')).toBe(
      'agent-deep-import',
    );
    expect(rule('src/shared/claude-settings.ts', 'src/agent/signals.ts')).toBe(
      'agent-deep-import',
    );
  });

  it('lets the TUI take agent types but not agent values', () => {
    expect(rule('src/ui/tui/App.tsx', 'src/agent/types.ts')).toBe(null);
    expect(rule('src/ui/tui/App.tsx', 'src/agent/index.ts')).toBe(
      'matrix:tui->agent',
    );
    expect(rule('src/ui/tui/App.tsx', 'src/agent/progress.ts')).toBe(
      'agent-deep-import',
    );
  });

  it('leaves agent-internal and non-agent edges to the matrix', () => {
    expect(rule('src/agent/runner/index.ts', 'src/agent/progress.ts')).toBe(
      null,
    );
    expect(rule('src/programs/audit/index.ts', 'src/ui/tui/store.ts')).toBe(
      'matrix:programs->tui',
    );
    expect(rule('src/agent/runner/index.ts', 'src/ui/tui/store.ts')).toBe(
      'matrix:agent->tui',
    );
  });
});

describe('programs entry modules', () => {
  const rule = (from: string, to: string) => ruleFor(from, to);

  it('lets the CLI and TUI reach programs through its entries', () => {
    expect(rule('src/commands/audit.ts', 'src/programs/index.ts')).toBe(null);
    expect(rule('src/ui/tui/store.ts', 'src/programs/types.ts')).toBe(null);
    expect(rule('src/commands/audit.ts', 'src/programs/audit/index.ts')).toBe(
      'programs-deep-import',
    );
  });

  it('keeps programs from reaching the TUI and CLI', () => {
    expect(rule('src/programs/audit/index.ts', 'src/ui/tui/store.ts')).toBe(
      'matrix:programs->tui',
    );
    expect(
      rule('src/programs/dispatch-family.ts', 'src/commands/command.ts'),
    ).toBe('matrix:programs->cli');
  });
});

describe('migration matrix', () => {
  it('lets legacy code use the programs entry', () => {
    expect(ruleFor('src/lib/wizard-session.ts', 'src/programs/index.ts')).toBe(
      null,
    );
  });

  it('keeps agent code out of legacy session state', () => {
    expect(
      ruleFor('src/agent/runner/index.ts', 'src/lib/wizard-session.ts'),
    ).toBe('matrix:agent->legacy');
  });
});
