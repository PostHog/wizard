import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  detectWarehouseSources,
  parseGemfile,
  parseEnvKeys,
} from '@lib/warehouse-sources/detect';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-detect-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writePackageJson(
  dir: string,
  deps: Record<string, string> = {},
  devDeps: Record<string, string> = {},
): void {
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ dependencies: deps, devDependencies: devDeps }),
  );
}

function kinds(dir: string): string[] {
  return detectWarehouseSources(dir)
    .map((s) => s.kind)
    .sort();
}

describe('detectWarehouseSources', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('returns empty for a non-existent directory', () => {
    expect(detectWarehouseSources(path.join(tmpDir, 'nope'))).toEqual([]);
  });

  it('returns empty when no source signal is present', () => {
    writePackageJson(tmpDir, { react: '^18.0.0' });
    expect(detectWarehouseSources(tmpDir)).toEqual([]);
  });

  it('detects Postgres from an npm driver dependency', () => {
    writePackageJson(tmpDir, { pg: '^8.0.0' });
    expect(kinds(tmpDir)).toEqual(['Postgres']);
  });

  it('detects Stripe from a dependency', () => {
    writePackageJson(tmpDir, { stripe: '^14.0.0' });
    const [stripe] = detectWarehouseSources(tmpDir);
    expect(stripe.kind).toBe('Stripe');
    expect(stripe.mode).toBe('in-cli');
    expect(stripe.matchedSignal).toContain('stripe');
  });

  it('detects a deep-link source (Sentry) and tags its mode', () => {
    writePackageJson(tmpDir, { '@sentry/node': '^7.0.0' });
    const [sentry] = detectWarehouseSources(tmpDir);
    expect(sentry.kind).toBe('Sentry');
    expect(sentry.mode).toBe('deep-link');
  });

  it('detects Postgres from a Python requirement', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'psycopg2-binary==2.9.9\nflask>=3.0\n',
    );
    expect(kinds(tmpDir)).toEqual(['Postgres']);
  });

  it('detects from .env key names without reading values', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      'DATABASE_URL=postgres://secret@host/db\nSTRIPE_SECRET_KEY=sk_live_x\n',
    );
    expect(kinds(tmpDir)).toEqual(['Postgres', 'Stripe']);
  });

  it('dedupes a source matched by multiple signals', () => {
    writePackageJson(tmpDir, { pg: '^8.0.0' });
    fs.writeFileSync(path.join(tmpDir, '.env'), 'DATABASE_URL=x\nPGHOST=y\n');
    expect(kinds(tmpDir)).toEqual(['Postgres']);
  });

  it('finds sources in nested packages (monorepo)', () => {
    const sub = path.join(tmpDir, 'apps', 'api');
    fs.mkdirSync(sub, { recursive: true });
    writePackageJson(sub, { mysql2: '^3.0.0' });
    expect(kinds(tmpDir)).toEqual(['MySQL']);
  });

  it('ignores node_modules', () => {
    const nm = path.join(tmpDir, 'node_modules', 'pg');
    fs.mkdirSync(nm, { recursive: true });
    writePackageJson(nm, { pg: '^8.0.0' });
    expect(detectWarehouseSources(tmpDir)).toEqual([]);
  });
});

describe('parseGemfile', () => {
  it('extracts gem names', () => {
    const content = `source 'https://rubygems.org'\ngem 'pg', '~> 1.5'\ngem "stripe"\n# gem 'commented'`;
    expect(parseGemfile(content)).toEqual(['pg', 'stripe']);
  });
});

describe('parseEnvKeys', () => {
  it('extracts key names and discards values', () => {
    const content =
      'export FOO=bar\nBAZ = qux\n# COMMENT=1\nDATABASE_URL=postgres://x';
    expect(parseEnvKeys(content)).toEqual(['FOO', 'BAZ', 'DATABASE_URL']);
  });
});
