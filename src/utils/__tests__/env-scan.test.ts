import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ENV_SCAN_MAX_DEPTH,
  collectProjectEnvKeys,
  isEnvFileName,
  parseEnvKeyNames,
  toRelativePosixPath,
} from '@utils/env-scan';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'env-scan-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeEnv(dir: string, relativePath: string, content: string): void {
  const full = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('isEnvFileName', () => {
  it.each([
    ['.env', true],
    ['.env.local', true],
    ['.env.production', true],
    ['.environment', true],
    ['env', false],
    ['package.json', false],
    ['sample.env', false],
  ])('classifies %s as %s', (name, expected) => {
    expect(isEnvFileName(name)).toBe(expected);
  });
});

describe('parseEnvKeyNames', () => {
  it('extracts key names and never the values', () => {
    const keys = parseEnvKeyNames(
      [
        '# COMMENT=ignored',
        '',
        'FOO=bar',
        '  BAR = "quoted"',
        'export OPENAI_API_KEY=sk-live-secret',
        'MY_KEY_2=x',
        'not a key value pair',
        'DB_URL=postgres://user:pw@host:5432/db?opt=1',
        '1INVALID=x',
      ].join('\n'),
    );

    expect(keys).toEqual([
      'FOO',
      'BAR',
      'OPENAI_API_KEY',
      'MY_KEY_2',
      'DB_URL',
    ]);
    expect(keys.join('|')).not.toContain('sk-live-secret');
    expect(keys.join('|')).not.toContain('pw');
  });
});

describe('toRelativePosixPath', () => {
  it('returns a project-relative path with forward slashes', () => {
    const root = path.resolve('/project');
    expect(
      toRelativePosixPath(root, path.join(root, 'apps', 'api', '.env')),
    ).toBe('apps/api/.env');
    expect(toRelativePosixPath(root, path.join(root, '.env.local'))).toBe(
      '.env.local',
    );
  });
});

describe('collectProjectEnvKeys', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('returns an empty map for a directory that does not exist', () => {
    expect(collectProjectEnvKeys(path.join(tmpDir, 'nope')).size).toBe(0);
  });

  it('returns an empty map for a project with no env files', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    expect(collectProjectEnvKeys(tmpDir).size).toBe(0);
  });

  it.each([
    ['.env'],
    ['.env.local'],
    ['.env.production'],
    ['apps/api/.env'],
    ['apps/web/.env.local'],
    ['packages/a/b/.env'],
  ])('finds a key in %s and reports that path', (relativePath) => {
    writeEnv(tmpDir, relativePath, 'OPENAI_API_KEY=sk-live-secret\n');
    expect(collectProjectEnvKeys(tmpDir).get('OPENAI_API_KEY')).toEqual([
      relativePath,
    ]);
  });

  it('lists every file that defines the same key, in walk order', () => {
    writeEnv(tmpDir, '.env', 'SHARED=a\n');
    writeEnv(tmpDir, 'apps/api/.env.local', 'SHARED=b\n');

    const found = collectProjectEnvKeys(tmpDir).get('SHARED');
    expect(found).toHaveLength(2);
    expect(found).toEqual(
      expect.arrayContaining(['.env', 'apps/api/.env.local']),
    );
  });

  it('reads the `export KEY=` form', () => {
    writeEnv(tmpDir, '.env.local', 'export ANTHROPIC_API_KEY=sk-ant-secret\n');
    expect(collectProjectEnvKeys(tmpDir).has('ANTHROPIC_API_KEY')).toBe(true);
  });

  it('never retains a value', () => {
    writeEnv(
      tmpDir,
      '.env.local',
      'OPENAI_API_KEY=sk-live-supersecret\nDATABASE_URL=postgres://u:pw@h/db\n',
    );

    const serialized = JSON.stringify([
      ...collectProjectEnvKeys(tmpDir).entries(),
    ]);
    expect(serialized).toContain('OPENAI_API_KEY');
    expect(serialized).not.toContain('supersecret');
    expect(serialized).not.toContain('postgres://');
  });

  it(`descends exactly ${ENV_SCAN_MAX_DEPTH} directory levels`, () => {
    const atLimit = ['a', 'b', 'c', '.env'].join('/');
    const pastLimit = ['a', 'b', 'c', 'd', '.env'].join('/');
    writeEnv(tmpDir, atLimit, 'IN_RANGE=x\n');
    writeEnv(tmpDir, pastLimit, 'TOO_DEEP=x\n');

    const found = collectProjectEnvKeys(tmpDir);
    expect(found.get('IN_RANGE')).toEqual([atLimit]);
    expect(found.has('TOO_DEEP')).toBe(false);
  });

  it('does not crash when .env is a directory', () => {
    // A Python virtualenv named `.env` — reading it used to throw EISDIR.
    fs.mkdirSync(path.join(tmpDir, '.env'));
    fs.writeFileSync(path.join(tmpDir, '.env', 'pyvenv.cfg'), 'home = /usr\n');
    writeEnv(tmpDir, '.env.local', 'STRIPE_SECRET_KEY=sk_live_x\n');

    const found = collectProjectEnvKeys(tmpDir);
    expect(found.get('STRIPE_SECRET_KEY')).toEqual(['.env.local']);
  });

  it('ignores env files inside dependency directories', () => {
    writeEnv(tmpDir, 'node_modules/some-pkg/.env', 'VENDORED_KEY=x\n');
    writeEnv(tmpDir, 'dist/.env', 'BUILT_KEY=x\n');
    writeEnv(tmpDir, '.env', 'REAL_KEY=x\n');

    const found = collectProjectEnvKeys(tmpDir);
    expect([...found.keys()]).toEqual(['REAL_KEY']);
  });
});
