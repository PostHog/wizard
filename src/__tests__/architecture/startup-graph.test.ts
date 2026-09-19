import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

const STATIC_IMPORT =
  /^\s*(?:import|export)\s+(?:type\s+)?[^'"]*?from\s*['"]([^'"]+)['"]/gm;
const BARE_IMPORT = /^\s*import\s*['"]([^'"]+)['"]/gm;

const ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^@env$/, 'src/env.ts'],
  [/^@store$/, 'src/store/index.ts'],
  [/^@store\/types$/, 'src/store/types.ts'],
  [/^@store\/programs$/, 'src/store/programs/index.ts'],
  [/^@agent$/, 'src/agent/index.ts'],
  [/^@agent\/types$/, 'src/agent/types.ts'],
  [/^@tui$/, 'src/tui/index.ts'],
  [/^@tui\/types$/, 'src/tui/types.ts'],
  [/^@tui\/console$/, 'src/tui/console/index.ts'],
  [/^@(store|agent|tui|cli)\/(.+)$/, 'src/$1/$2'],
];

function resolveFile(spec: string, from: string): string | null {
  let base: string | null = null;
  if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else {
    for (const [pattern, target] of ALIASES) {
      if (pattern.test(spec)) {
        base = path.join(REPO_ROOT, spec.replace(pattern, target));
        break;
      }
    }
  }
  if (base === null) return null;
  const stem = base.replace(/\.js$/, '');
  for (const candidate of [
    `${stem}.ts`,
    `${stem}.tsx`,
    path.join(stem, 'index.ts'),
    path.join(stem, 'index.tsx'),
    base,
  ]) {
    if (fs.statSync(candidate, { throwIfNoEntry: false })?.isFile())
      return candidate;
  }
  return null;
}

/** Static import closure: every module Node evaluates before main.ts runs. */
function staticClosure(entry: string): {
  files: Set<string>;
  packages: Set<string>;
} {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [path.join(REPO_ROOT, entry)];
  while (queue.length) {
    const file = queue.pop();
    if (!file || files.has(file)) continue;
    files.add(file);
    const text = fs.readFileSync(file, 'utf8');
    // Type-only imports are erased; they never load a module.
    const specs = [...text.matchAll(STATIC_IMPORT)]
      .filter((m) => !/^\s*(import|export)\s+type\b/.test(m[0]))
      .map((m) => m[1])
      .concat([...text.matchAll(BARE_IMPORT)].map((m) => m[1]));
    for (const spec of specs) {
      const resolved = resolveFile(spec, file);
      if (resolved) queue.push(resolved);
      else if (!spec.startsWith('.')) packages.add(spec);
    }
  }
  return { files, packages };
}

const closure = staticClosure('src/cli/main.ts');
const rel = (abs: string) =>
  path.relative(REPO_ROOT, abs).split(path.sep).join('/');

describe('cli startup graph', () => {
  it('reaches the tui only through its Ink-free console renderers', () => {
    const tui = [...closure.files]
      .map(rel)
      .filter(
        (f) => f.startsWith('src/tui/') && !f.startsWith('src/tui/console/'),
      );
    expect(tui).toEqual([]);
  });

  it('loads neither Ink nor React before a command runs', () => {
    const ui = [...closure.packages].filter(
      (p) =>
        ['ink', 'react', '@inkjs/ui'].includes(p) || p.startsWith('react/'),
    );
    expect(ui).toEqual([]);
  });

  it('never loads the control server statically', () => {
    const control = [...closure.files]
      .map(rel)
      .filter((f) => f === 'src/store/control/server.ts');
    expect(control).toEqual([]);
  });

  it('does not load the agent runner before a command runs', () => {
    const agent = [...closure.files]
      .map(rel)
      .filter((f) => f.startsWith('src/agent/'));
    expect(agent).toEqual([]);
  });
});
