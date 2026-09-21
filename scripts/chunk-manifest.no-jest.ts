/**
 * Structural manifest of the built bundle: for every chunk in dist/, the
 * source files it contains (from its sourcemap) and the chunks it imports.
 * Hash suffixes are stripped so the output is stable across builds.
 *
 *   tsx scripts/chunk-manifest.no-jest.ts [distDir] > manifest.json
 *   tsx scripts/chunk-manifest.no-jest.ts [distDir] --summary > summary.json
 *
 * `--summary` prints the chunk names and the sorted set of every bundled
 * source. Output differs between macOS and Linux (chunk assignment and
 * sourcemap sources), so this is a reading tool, not a golden.
 */
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const summary = args.includes('--summary');
const dist = path.resolve(args.find((a) => !a.startsWith('--')) ?? 'dist');
const root = path.resolve(dist, '..');

const stripHash = (file: string): string =>
  file.replace(/-[A-Za-z0-9_-]{8}\.js$/, '.js');

const importRe = /(?:from\s*|import\s*\(\s*)["']\.\/([^"']+\.js)["']/g;

const manifest: Record<string, { sources: string[]; imports: string[] }> = {};

for (const file of fs
  .readdirSync(dist)
  .filter((f) => f.endsWith('.js'))
  .sort()) {
  const code = fs.readFileSync(path.join(dist, file), 'utf8');
  const mapPath = path.join(dist, `${file}.map`);
  const sources = fs.existsSync(mapPath)
    ? (
        JSON.parse(fs.readFileSync(mapPath, 'utf8')) as { sources: string[] }
      ).sources
        .map((s) => path.relative(root, path.resolve(dist, s)))
        .filter((s) => !s.includes('node_modules'))
        .sort()
    : [];
  const imports = new Set<string>();
  for (const m of code.matchAll(importRe)) imports.add(stripHash(m[1]));
  manifest[stripHash(file)] = { sources, imports: [...imports].sort() };
}

const output = summary
  ? {
      chunks: Object.keys(manifest).sort(),
      sources: [
        ...new Set(Object.values(manifest).flatMap((c) => c.sources)),
      ].sort(),
    }
  : manifest;
process.stdout.write(JSON.stringify(output, null, 2) + '\n');
