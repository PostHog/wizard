import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

const CONSUMERS: ReadonlyArray<readonly [string, string[]]> = [
  ['agent', ['src/agent']],
  ['tui', ['src/tui']],
  ['cli', ['src/cli', 'bin.ts']],
];
const PUBLIC = /^@(store|agent|tui)(\/(types|programs|console))?$/;
const NAMED_IMPORT =
  /^(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gm;
const DYNAMIC =
  /const\s*\{([^}]*)\}\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]\s*\)/g;

function files(root: string, into: string[]): void {
  const abs = path.join(REPO_ROOT, root);
  if (fs.statSync(abs).isFile()) {
    into.push(abs);
    return;
  }
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'testing') continue;
    const p = path.join(abs, entry.name);
    if (entry.isDirectory()) files(path.relative(REPO_ROOT, p), into);
    else if (/\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name))
      into.push(p);
  }
}

/** Names a surface pulls from each public entry of another surface. */
function consumed(roots: string[]): Record<string, string[]> {
  const list: string[] = [];
  for (const r of roots) files(r, list);
  const out = new Map<string, Set<string>>();
  const add = (spec: string, names: string) => {
    if (!PUBLIC.test(spec)) return;
    const set = out.get(spec) ?? new Set<string>();
    for (const raw of names.split(',')) {
      const name = raw
        .trim()
        .replace(/^type\s+/, '')
        .replace(/\s+as\s+.*$/, '');
      if (name) set.add(name);
    }
    out.set(spec, set);
  };
  for (const file of list) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(NAMED_IMPORT)) add(m[2], m[1]);
    for (const m of text.matchAll(DYNAMIC)) add(m[2], m[1]);
  }
  return Object.fromEntries(
    [...out]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([spec, names]) => [spec, [...names].sort()]),
  );
}

describe('boundary contracts', () => {
  it.each(CONSUMERS)(
    '%s consumes exactly the recorded names from other surfaces',
    (_name, roots) => {
      expect(consumed(roots)).toMatchSnapshot();
    },
  );
});
