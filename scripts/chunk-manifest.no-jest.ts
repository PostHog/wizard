/**
 * Structural manifest of the built bundle, keyed by content rather than by
 * chunk file name: every chunk that carries source files becomes a group named
 * after its first source; imports point at the groups they reach, with empty
 * facade chunks resolved through. Chunk names and hashes vary by platform;
 * which modules share a chunk and who imports whom does not.
 *
 *   tsx scripts/chunk-manifest.no-jest.ts [distDir] > manifest.json
 */
import fs from 'fs';
import path from 'path';

const dist = path.resolve(process.argv[2] ?? 'dist');
const root = path.resolve(dist, '..');

const stripHash = (file: string): string =>
  file.replace(/-[A-Za-z0-9_-]{8}\.js$/, '.js');

const importRe = /(?:from\s*|import\s*\(\s*)["']\.\/([^"']+\.js)["']/g;

interface Chunk {
  sources: string[];
  imports: string[];
}

const chunks: Record<string, Chunk> = {};
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
  chunks[stripHash(file)] = { sources, imports: [...imports].sort() };
}

/** The groups a chunk reaches: itself when it carries sources, else what it re-exports. */
function groupsOf(name: string, seen = new Set<string>()): string[] {
  const chunk = chunks[name];
  if (!chunk || seen.has(name)) return [];
  seen.add(name);
  if (chunk.sources.length) return [chunk.sources[0]];
  return chunk.imports.flatMap((i) => groupsOf(i, seen));
}

const manifest: Record<string, Chunk> = {};
for (const [name, chunk] of Object.entries(chunks)) {
  if (!chunk.sources.length) continue;
  const imports = new Set<string>();
  for (const i of chunk.imports) for (const g of groupsOf(i)) imports.add(g);
  imports.delete(chunk.sources[0]);
  manifest[chunk.sources[0]] = {
    sources: chunk.sources,
    imports: [...imports].sort(),
  };
  void name;
}

const sorted = Object.fromEntries(
  Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)),
);
process.stdout.write(JSON.stringify(sorted, null, 2) + '\n');
