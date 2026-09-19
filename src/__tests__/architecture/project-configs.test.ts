import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ALLOWED_IMPORTS, type Surface } from './import-boundaries.test.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

/** Compiler project per surface; env is the shared root file. */
const PROJECTS: Record<Exclude<Surface, 'harness'>, string> = {
  env: 'tsconfig.env.json',
  store: 'src/store/tsconfig.json',
  agent: 'src/agent/tsconfig.json',
  tui: 'src/tui/tsconfig.json',
  cli: 'src/cli/tsconfig.json',
};

function referencesOf(configRel: string): string[] {
  const abs = path.join(REPO_ROOT, configRel);
  const cfg = JSON.parse(fs.readFileSync(abs, 'utf8')) as {
    references?: Array<{ path: string }>;
  };
  return (cfg.references ?? []).map((r) =>
    path
      .relative(REPO_ROOT, path.resolve(path.dirname(abs), r.path))
      .split(path.sep)
      .join('/'),
  );
}

function projectDir(configRel: string): string {
  return configRel.endsWith('.json') && !configRel.includes('/')
    ? configRel
    : path.dirname(configRel);
}

describe('tsconfig project references', () => {
  it.each(Object.keys(PROJECTS) as Array<keyof typeof PROJECTS>)(
    '%s references exactly the surfaces it may import',
    (surface) => {
      const expected = ALLOWED_IMPORTS[surface]
        .filter((s) => s !== surface)
        .map((s) => projectDir(PROJECTS[s as keyof typeof PROJECTS]))
        .sort();
      expect(referencesOf(PROJECTS[surface]).sort()).toEqual(expected);
    },
  );

  it('the solution lists every project', () => {
    const refs = referencesOf('tsconfig.solution.json');
    for (const p of Object.values(PROJECTS)) {
      expect(refs).toContain(projectDir(p));
    }
  });
});
