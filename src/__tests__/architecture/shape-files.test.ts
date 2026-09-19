import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

const SHAPE_FILES = [
  'src/store/types.ts',
  'src/agent/types.ts',
  'src/tui/types.ts',
  'src/cli/types.ts',
];

/** Every import or export with a module specifier, with its leading keywords. */
function moduleStatements(source: string): string[] {
  return [
    ...source.matchAll(/^(import|export)\b[^;]*?\bfrom\s*['"][^'"]+['"]/gm),
  ].map((m) => m[0].replace(/\s+/g, ' '));
}

describe('shape files', () => {
  it.each(SHAPE_FILES)('%s has zero runtime imports', (file) => {
    const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
    const runtime = moduleStatements(source).filter(
      (s) => !/^(import|export) type\b/.test(s),
    );
    expect(runtime).toEqual([]);
  });

  it.each(SHAPE_FILES)('%s imports only shape files and @env', (file) => {
    const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
    const own = file.split('/')[1];
    const foreign = [...source.matchAll(/from\s*['"]([^'"]+)['"]/g)]
      .map((m) => m[1])
      .filter((spec) => !spec.startsWith('.'))
      .filter((spec) => spec !== '@env' && spec !== `@${own}/types`)
      .filter((spec) => !/^@(store|agent|tui)\/types$/.test(spec));
    expect(foreign).toEqual([]);
  });
});
