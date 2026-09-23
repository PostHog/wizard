import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  boundedGlob,
  readFileHead,
  readProjectFile,
  MAX_GLOB_MATCHES,
} from '@utils/bounded-fs';

describe('boundedGlob', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bounded-glob-'));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('stops at the match limit on a wide directory', async () => {
    for (let i = 0; i < 50; i++) {
      fs.writeFileSync(path.join(dir, `file-${i}.ts`), 'x');
    }
    const matches = await boundedGlob('**/*.ts', { cwd: dir, limit: 10 });
    expect(matches.length).toBe(10);
  });

  it('defaults the limit to MAX_GLOB_MATCHES', async () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'x');
    const matches = await boundedGlob('**/*.ts', { cwd: dir });
    expect(matches).toEqual(['a.ts']);
    expect(MAX_GLOB_MATCHES).toBeGreaterThan(0);
  });

  it('never descends into shared ignored dirs (.git included)', async () => {
    fs.mkdirSync(path.join(dir, '.git/objects'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.git/objects/x.ts'), 'x');
    fs.mkdirSync(path.join(dir, 'node_modules/dep'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules/dep/y.ts'), 'x');
    fs.writeFileSync(path.join(dir, 'app.ts'), 'x');
    const matches = await boundedGlob('**/*.ts', { cwd: dir, dot: true });
    expect(matches).toEqual(['app.ts']);
  });

  it('applies extraIgnore on top of the shared set', async () => {
    fs.mkdirSync(path.join(dir, 'storage'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'storage/z.php'), 'x');
    fs.writeFileSync(path.join(dir, 'app.php'), 'x');
    const matches = await boundedGlob('**/*.php', {
      cwd: dir,
      extraIgnore: ['**/storage/**'],
    });
    expect(matches).toEqual(['app.php']);
  });
});

describe('readProjectFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bounded-read-'));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reads a normal file', () => {
    const p = path.join(dir, 'ok.txt');
    fs.writeFileSync(p, 'hello');
    expect(readProjectFile(p)).toBe('hello');
  });

  it('returns null for a file over the cap without materializing it', () => {
    const p = path.join(dir, 'fat.txt');
    fs.writeFileSync(p, 'x'.repeat(1024));
    expect(readProjectFile(p, 512)).toBeNull();
  });

  it('returns null for a missing file', () => {
    expect(readProjectFile(path.join(dir, 'nope.txt'))).toBeNull();
  });
});

describe('readFileHead', () => {
  it('reads only the head of a large file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bounded-head-'));
    const p = path.join(dir, 'lock.yaml');
    fs.writeFileSync(p, '# yarn lockfile v1\n' + 'y'.repeat(10_000));
    const head = readFileHead(p, 500);
    expect(head?.length).toBe(500);
    expect(head).toContain('yarn lockfile');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
