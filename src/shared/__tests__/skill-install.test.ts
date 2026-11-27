import * as fs from 'fs';
import nodeFs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { zipSync } from 'fflate';
import { analytics } from '@utils/analytics';
import {
  __test,
  downloadSkill,
  listSkillFolders,
  removeRunSkills,
} from '@shared/skill-install';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-tools-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('extractZipArchive', () => {
  let dest: string;

  beforeEach(() => {
    dest = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-zip-'));
  });

  afterEach(() => {
    cleanup(dest);
  });

  it('writes files and nested directories from the archive', () => {
    const zip = zipSync({
      'SKILL.md': new TextEncoder().encode('# skill'),
      'references/deep/notes.md': new TextEncoder().encode('notes'),
    });

    const written = __test.extractZipArchive(zip, dest);

    expect(written).toBe(2);
    expect(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8')).toBe(
      '# skill',
    );
    expect(
      fs.readFileSync(path.join(dest, 'references/deep/notes.md'), 'utf8'),
    ).toBe('notes');
  });

  it('rejects zip-slip entries that escape the destination', () => {
    const zip = zipSync({
      '../evil.txt': new TextEncoder().encode('pwned'),
    });

    expect(() => __test.extractZipArchive(zip, dest)).toThrow(
      /escapes destination/,
    );
    expect(fs.existsSync(path.join(dest, '..', 'evil.txt'))).toBe(false);
  });

  it('rejects absolute entry paths', () => {
    const zip = zipSync({
      '/etc/evil.txt': new TextEncoder().encode('pwned'),
    });

    expect(() => __test.extractZipArchive(zip, dest)).toThrow(
      /escapes destination/,
    );
  });

  it('refuses a "." file entry that targets the destination root', () => {
    const zip = zipSync({
      '.': new TextEncoder().encode('pwned'),
    });

    expect(() => __test.extractZipArchive(zip, dest)).toThrow(
      /overwrites destination/,
    );
  });

  it('refuses a hard-linked target file and extracts nothing ahead of it', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-hardlink-'));
    try {
      const victim = path.join(outside, 'victim.txt');
      fs.writeFileSync(victim, 'safe');
      fs.linkSync(victim, path.join(dest, 'linked.md'));
      const zip = zipSync({
        'first.md': new TextEncoder().encode('should not land'),
        'linked.md': new TextEncoder().encode('pwned'),
      });

      expect(() => __test.extractZipArchive(zip, dest)).toThrow(/hard link/);
      expect(fs.readFileSync(victim, 'utf8')).toBe('safe');
      expect(fs.existsSync(path.join(dest, 'first.md'))).toBe(false);
    } finally {
      cleanup(outside);
    }
  });
});

describe('extractZipArchive and a raced hard link', () => {
  it('refuses a hard link that appears after validation without truncating its target', () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-zip-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-outside-'));
    const victim = path.join(outside, 'victim.txt');
    fs.writeFileSync(victim, 'safe');
    const realOpen = nodeFs.openSync.bind(nodeFs);
    const open = vi
      .spyOn(nodeFs, 'openSync')
      .mockImplementation((target, ...rest) => {
        const file = String(target);
        if (file.endsWith('SKILL.md') && !fs.existsSync(file)) {
          fs.linkSync(victim, file);
        }
        return realOpen(target, ...rest);
      });
    try {
      const zip = zipSync({ 'SKILL.md': new TextEncoder().encode('pwned') });
      expect(() => __test.extractZipArchive(zip, dest)).toThrow(/hard link/);
      expect(open).toHaveBeenCalled();
      expect(fs.readFileSync(victim, 'utf8')).toBe('safe');
    } finally {
      open.mockRestore();
      cleanup(dest);
      cleanup(outside);
    }
  });
});

describe('extractZipArchive and symlinks', () => {
  let dest: string;
  let outside: string;

  beforeEach(() => {
    dest = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-zip-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-outside-'));
  });
  afterEach(() => {
    cleanup(dest);
    cleanup(outside);
  });

  it('refuses an entry that lands on a symlinked file', () => {
    const victim = path.join(outside, 'victim.txt');
    fs.writeFileSync(victim, 'safe');
    fs.symlinkSync(victim, path.join(dest, 'SKILL.md'));
    const zip = zipSync({ 'SKILL.md': new TextEncoder().encode('pwned') });

    expect(() => __test.extractZipArchive(zip, dest)).toThrow(/link/);
    expect(fs.readFileSync(victim, 'utf8')).toBe('safe');
  });

  it('refuses an entry under a symlinked folder', () => {
    fs.symlinkSync(outside, path.join(dest, 'references'));
    const zip = zipSync({
      'references/EXAMPLE.md': new TextEncoder().encode('pwned'),
    });

    expect(() => __test.extractZipArchive(zip, dest)).toThrow(/link/);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('refuses a symlinked destination folder', () => {
    const link = path.join(dest, 'link');
    fs.symlinkSync(outside, link);
    const zip = zipSync({ 'SKILL.md': new TextEncoder().encode('pwned') });

    expect(() => __test.extractZipArchive(zip, link)).toThrow();
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});

describe('extractZipArchive over what is already there', () => {
  let dest: string;
  const bytes = (text: string) => new TextEncoder().encode(text);
  const none = new Uint8Array(0);

  beforeEach(() => {
    dest = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-zip-'));
  });
  afterEach(() => cleanup(dest));

  it('overwrites plain files and folders when extracted twice', () => {
    const first = zipSync({
      'SKILL.md': bytes('a long first body'),
      'refs/': none,
      'refs/deep/': none,
      'refs/deep/note.md': bytes('first long note'),
    });
    const second = zipSync({
      'SKILL.md': bytes('short'),
      'refs/': none,
      'refs/deep/': none,
      'refs/deep/note.md': bytes('2nd'),
    });

    expect(__test.extractZipArchive(first, dest)).toBe(2);
    expect(__test.extractZipArchive(second, dest)).toBe(2);

    expect(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8')).toBe('short');
    expect(fs.readFileSync(path.join(dest, 'refs/deep/note.md'), 'utf8')).toBe(
      '2nd',
    );
  });

  it('creates an empty folder entry without counting it, and the destination when missing', () => {
    const target = path.join(dest, 'new', 'skill');

    expect(__test.extractZipArchive(zipSync({ 'empty/': none }), target)).toBe(
      0,
    );

    expect(fs.statSync(path.join(target, 'empty')).isDirectory()).toBe(true);
  });

  it('accepts a folder entry for the destination itself', () => {
    expect(
      __test.extractZipArchive(
        zipSync({ './': none, 'SKILL.md': bytes('x') }),
        dest,
      ),
    ).toBe(1);
  });

  it('refuses a file entry that lands on a folder and leaves the folder', () => {
    fs.mkdirSync(path.join(dest, 'SKILL.md'));

    expect(() =>
      __test.extractZipArchive(zipSync({ 'SKILL.md': bytes('x') }), dest),
    ).toThrow(/link/);

    expect(fs.statSync(path.join(dest, 'SKILL.md')).isDirectory()).toBe(true);
  });

  it('refuses a folder entry that lands on a file and leaves the file', () => {
    fs.writeFileSync(path.join(dest, 'refs'), 'keep');

    expect(() =>
      __test.extractZipArchive(zipSync({ 'refs/': none }), dest),
    ).toThrow(/link/);

    expect(fs.readFileSync(path.join(dest, 'refs'), 'utf8')).toBe('keep');
  });

  it('refuses an entry whose parent is an existing file', () => {
    fs.writeFileSync(path.join(dest, 'refs'), 'keep');

    expect(() =>
      __test.extractZipArchive(zipSync({ 'refs/a.md': bytes('x') }), dest),
    ).toThrow(/link/);

    expect(fs.readFileSync(path.join(dest, 'refs'), 'utf8')).toBe('keep');
  });

  it('refuses a destination that is a file', () => {
    const file = path.join(dest, 'file');
    fs.writeFileSync(file, 'keep');

    expect(() =>
      __test.extractZipArchive(zipSync({ 'a.md': bytes('x') }), file),
    ).toThrow(/not a plain folder/);

    expect(fs.readFileSync(file, 'utf8')).toBe('keep');
  });

  it('closes every file it opens', () => {
    const close = vi.spyOn(nodeFs, 'closeSync');
    try {
      __test.extractZipArchive(
        zipSync({ 'a.md': bytes('a'), 'b/c.md': bytes('c') }),
        dest,
      );
      expect(close).toHaveBeenCalledTimes(2);
    } finally {
      close.mockRestore();
    }
  });
});

describe('downloadSkill and symlinks', () => {
  let installDir: string;
  let outside: string;
  const zip = zipSync({ 'SKILL.md': new TextEncoder().encode('# skill') });
  const entry = {
    id: 'dummy',
    name: 'Dummy',
    downloadUrl: 'http://x.test/a.zip',
  };

  beforeEach(() => {
    installDir = makeTmpDir();
    outside = makeTmpDir();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(Buffer.from(zip)))),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup(installDir);
    cleanup(outside);
  });

  it('refuses a symlinked leaf skill folder and writes nothing outside', async () => {
    const root = path.join(installDir, '.cache', 'sdk');
    fs.mkdirSync(root, { recursive: true });
    fs.symlinkSync(outside, path.join(root, 'dummy'));

    const result = await downloadSkill(entry, installDir, {
      skillsRoot: '.cache/sdk',
      scan: () => Promise.resolve(null),
    });

    expect(result.success).toBe(false);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('refuses a symlinked folder above the skill under a wizard-owned root', async () => {
    fs.symlinkSync(outside, path.join(installDir, '.cache'));

    const result = await downloadSkill(entry, installDir, {
      skillsRoot: '.cache/sdk',
      scan: () => Promise.resolve(null),
    });

    expect(result.success).toBe(false);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('refuses a symlinked .claude directory pointing outside installDir, and allows one inside installDir', async () => {
    fs.symlinkSync(outside, path.join(installDir, '.claude'));

    const blocked = await downloadSkill(entry, installDir, {
      scan: () => Promise.resolve(null),
    });

    expect(blocked.success).toBe(false);
    expect(fs.readdirSync(outside)).toEqual([]);

    fs.rmSync(path.join(installDir, '.claude'));
    const sharedSkills = path.join(installDir, 'shared-skills');
    fs.mkdirSync(sharedSkills, { recursive: true });
    fs.mkdirSync(path.join(installDir, '.claude'), { recursive: true });
    fs.symlinkSync(sharedSkills, path.join(installDir, '.claude', 'skills'));

    const allowed = await downloadSkill(entry, installDir, {
      scan: () => Promise.resolve(null),
    });
    expect(allowed.success).toBe(true);
    expect(fs.existsSync(path.join(sharedSkills, 'dummy', 'SKILL.md'))).toBe(
      true,
    );
  });

  it('refuses to replace an existing unmarked skill folder unless ownsSkillsRoot is true', async () => {
    const skillDir = path.join(installDir, '.claude', 'skills', 'dummy');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'USER.md'), 'keep me');

    const refused = await downloadSkill(entry, installDir, {
      scan: () => Promise.resolve(null),
    });
    expect(refused.success).toBe(false);
    expect(fs.readFileSync(path.join(skillDir, 'USER.md'), 'utf8')).toBe(
      'keep me',
    );

    const owned = await downloadSkill(entry, installDir, {
      ownsSkillsRoot: true,
      scan: () => Promise.resolve(null),
    });
    expect(owned.success).toBe(true);
    expect(fs.existsSync(path.join(skillDir, 'SKILL.md'))).toBe(true);
  });

  it('rejects intra-archive file/dir clashes and leaves existing skillDir untouched', async () => {
    const skillDir = path.join(installDir, '.claude', 'skills', 'dummy');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'ORIGINAL');
    const clashingZip = zipSync({
      'SKILL.md': new TextEncoder().encode('POISONED'),
      x: new TextEncoder().encode('file'),
      'x/': new Uint8Array(),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(Buffer.from(clashingZip)))),
    );
    const scan = vi.fn(() => Promise.resolve(null));

    const result = await downloadSkill(entry, installDir, { scan });

    expect(result.success).toBe(false);
    expect(scan).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8')).toBe(
      'ORIGINAL',
    );
  });

  it('refuses a symlinked skill folder under the default root', async () => {
    const skills = path.join(installDir, '.claude', 'skills');
    fs.mkdirSync(skills, { recursive: true });
    fs.symlinkSync(outside, path.join(skills, 'dummy'));

    const result = await downloadSkill(entry, installDir, {
      scan: () => Promise.resolve(null),
    });

    expect(result.success).toBe(false);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('refuses a symlinked wizard marker file and leaves zero newly extracted files', async () => {
    const skillDir = path.join(installDir, '.claude', 'skills', 'dummy');
    fs.mkdirSync(skillDir, { recursive: true });
    const victim = path.join(outside, 'marker-target');
    fs.writeFileSync(victim, 'safe');
    fs.symlinkSync(victim, path.join(skillDir, '.posthog-wizard'));

    const result = await downloadSkill(entry, installDir, {
      scan: () => Promise.resolve(null),
    });

    expect(result.success).toBe(false);
    expect(fs.readFileSync(victim, 'utf8')).toBe('safe');
    expect(fs.existsSync(path.join(skillDir, 'SKILL.md'))).toBe(false);
  });

  it('refuses a hard-linked wizard marker file', async () => {
    const skillDir = path.join(installDir, '.claude', 'skills', 'dummy');
    fs.mkdirSync(skillDir, { recursive: true });
    const victim = path.join(outside, 'marker-hardlink');
    fs.writeFileSync(victim, 'safe');
    fs.linkSync(victim, path.join(skillDir, '.posthog-wizard'));

    const result = await downloadSkill(entry, installDir, {
      scan: () => Promise.resolve(null),
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/hard link/);
    expect(fs.readFileSync(victim, 'utf8')).toBe('safe');
    expect(fs.existsSync(path.join(skillDir, 'SKILL.md'))).toBe(false);
  });

  it('refuses an absolute skillsRoot before creating directories', async () => {
    const result = await downloadSkill(entry, installDir, {
      skillsRoot: path.join(outside, 'abs'),
      scan: () => Promise.resolve(null),
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/escapes destination/);
    expect(fetch).not.toHaveBeenCalled();
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('handles relative installDir ("." and "apps/web") and still refuses escaping skillsRoot', async () => {
    const origCwd = process.cwd();
    const webDir = path.join(installDir, 'apps', 'web');
    fs.mkdirSync(webDir, { recursive: true });
    process.chdir(installDir);
    try {
      const dotInstall = await downloadSkill(entry, '.', {
        scan: () => Promise.resolve(null),
      });
      expect(dotInstall).toEqual({ success: true });
      expect(
        fs.existsSync(
          path.join(
            installDir,
            '.claude',
            'skills',
            'dummy',
            '.posthog-wizard',
          ),
        ),
      ).toBe(true);

      const relInstall = await downloadSkill(entry, 'apps/web', {
        scan: () => Promise.resolve(null),
      });
      expect(relInstall).toEqual({ success: true });
      expect(
        fs.existsSync(
          path.join(webDir, '.claude', 'skills', 'dummy', 'SKILL.md'),
        ),
      ).toBe(true);

      const escaped = await downloadSkill(entry, 'apps/web', {
        skillsRoot: '../outside',
        scan: () => Promise.resolve(null),
      });
      expect(escaped.success).toBe(false);
      expect(escaped.error).toMatch(/escapes destination/);
      expect(fs.existsSync(path.join(installDir, 'apps', 'outside'))).toBe(
        false,
      );
    } finally {
      process.chdir(origCwd);
    }
  });

  it('refuses a skills root that leaves installDir and writes nothing outside', async () => {
    const result = await downloadSkill(entry, installDir, {
      skillsRoot: path.relative(installDir, path.join(outside, 'out')),
      scan: () => Promise.resolve(null),
    });

    expect(result).toMatchObject({ success: false });
    expect(result.error).toMatch(/escapes destination/);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it.each(['../escaped', '..', '.', '', 'a/b', '-x'])(
    'refuses the skill id %j before touching the disk',
    async (id) => {
      const result = await downloadSkill({ ...entry, id }, installDir, {
        scan: () => Promise.resolve(null),
      });

      expect(result).toEqual({
        success: false,
        error: `unusable skill id: ${id}`,
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(fs.readdirSync(installDir)).toEqual([]);
    },
  );

  it('installs over its own earlier install, marker included', async () => {
    const options = { scan: () => Promise.resolve(null) };

    expect(await downloadSkill(entry, installDir, options)).toEqual({
      success: true,
    });
    expect(await downloadSkill(entry, installDir, options)).toEqual({
      success: true,
    });

    const skillDir = path.join(installDir, '.claude', 'skills', 'dummy');
    expect(fs.existsSync(path.join(skillDir, '.posthog-wizard'))).toBe(true);
  });

  it('leaves no folder behind when the archive is unusable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(Buffer.from('not a zip')))),
    );

    const result = await downloadSkill(entry, installDir, {
      scan: () => Promise.resolve(null),
    });

    expect(result.success).toBe(false);
    expect(
      fs.existsSync(path.join(installDir, '.claude', 'skills', 'dummy')),
    ).toBe(false);
  });

  it('installs through a symlinked installDir', async () => {
    const link = `${installDir}-link`;
    fs.symlinkSync(installDir, link);
    try {
      const result = await downloadSkill(entry, link, {
        scan: () => Promise.resolve(null),
      });
      expect(result.success).toBe(true);
      expect(
        fs.existsSync(
          path.join(installDir, '.claude', 'skills', 'dummy', 'SKILL.md'),
        ),
      ).toBe(true);
    } finally {
      fs.rmSync(link, { force: true });
    }
  });
});

describe('downloadWithRetry', () => {
  const url = 'https://example.com/skill.zip';
  const noSleep = () => Promise.resolve();
  const okResponse = () =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(3)),
    });

  it('returns the body on first success without sleeping', async () => {
    let fetches = 0;

    const bytes = await __test.downloadWithRetry(url, {
      fetchImpl: (() => {
        fetches += 1;
        return okResponse();
      }) as any,
      sleepImpl: () => {
        throw new Error('should not sleep');
      },
    });

    expect(fetches).toBe(1);
    expect(bytes).toHaveLength(3);
  });

  it('retries with exponential backoff before succeeding', async () => {
    let attempts = 0;
    const sleeps: number[] = [];

    const bytes = await __test.downloadWithRetry(url, {
      fetchImpl: (() => {
        attempts += 1;
        if (attempts < 3) return Promise.reject(new Error('fetch failed'));
        return okResponse();
      }) as any,
      sleepImpl: (ms: number) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      backoffMs: 500,
    });

    expect(attempts).toBe(3);
    expect(sleeps).toEqual([500, 1000]);
    expect(bytes).toHaveLength(3);
  });

  it('treats a non-ok response as a failure and retries it', async () => {
    let attempts = 0;

    await expect(
      __test.downloadWithRetry(url, {
        fetchImpl: (() => {
          attempts += 1;
          return Promise.resolve({
            ok: false,
            status: 503,
            statusText: 'Service Unavailable',
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
          });
        }) as any,
        sleepImpl: noSleep,
        maxAttempts: 2,
      }),
    ).rejects.toThrow(/HTTP 503 Service Unavailable/);

    expect(attempts).toBe(2);
  });

  it('lists each attempt when they fail differently', async () => {
    const errors = ['ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT'];
    let i = 0;
    await expect(
      __test.downloadWithRetry(url, {
        fetchImpl: (() => Promise.reject(new Error(errors[i++]))) as any,
        sleepImpl: noSleep,
        maxAttempts: 3,
      }),
    ).rejects.toThrow(/attempt 1.*attempt 2.*attempt 3/s);
  });

  it('fails fast on a non-retryable client error, without retrying or sleeping', async () => {
    let attempts = 0;
    let slept = false;

    await expect(
      __test.downloadWithRetry(url, {
        fetchImpl: (() => {
          attempts += 1;
          return Promise.resolve({
            ok: false,
            status: 404,
            statusText: 'Not Found',
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
          });
        }) as any,
        sleepImpl: () => {
          slept = true;
          return Promise.resolve();
        },
        maxAttempts: 3,
      }),
    ).rejects.toThrow(/HTTP 404 Not Found/);

    expect(attempts).toBe(1);
    expect(slept).toBe(false);
  });

  it('still retries a 429 rate-limit response', async () => {
    let attempts = 0;

    await expect(
      __test.downloadWithRetry(url, {
        fetchImpl: (() => {
          attempts += 1;
          return Promise.resolve({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
          });
        }) as any,
        sleepImpl: noSleep,
        maxAttempts: 3,
      }),
    ).rejects.toThrow(/attempt 3: HTTP 429/);

    expect(attempts).toBe(3);
  });
});

describe('downloadSkill (e2e over HTTP)', () => {
  let tmpDir: string;
  const clean = () => Promise.resolve(null);

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  // A minimal valid zip the real unzipSync path can extract.
  const dummyZip = (): Uint8Array =>
    zipSync({ 'SKILL.md': new TextEncoder().encode('# dummy skill\n') });

  // Start a throwaway HTTP server on a random port; returns its base URL + closer.
  async function startServer(
    handler: http.RequestListener,
  ): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const server = http.createServer(handler);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as import('net').AddressInfo;
    return {
      baseUrl: `http://127.0.0.1:${port}`,
      close: () => new Promise((resolve) => server.close(() => resolve())),
    };
  }

  const skillFile = () =>
    path.join(tmpDir, '.claude', 'skills', 'dummy', 'SKILL.md');

  it('downloads and extracts a skill served by the mock server', async () => {
    const zip = dummyZip();
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/zip' });
      res.end(Buffer.from(zip));
    });

    try {
      const result = await downloadSkill(
        {
          id: 'dummy',
          name: 'Dummy',
          downloadUrl: `${server.baseUrl}/skill.zip`,
        },
        tmpDir,
        { scan: clean },
      );

      expect(result.success).toBe(true);
      expect(fs.readFileSync(skillFile(), 'utf8')).toContain('dummy skill');
    } finally {
      await server.close();
    }
  });

  it('recovers when the server fails transiently before serving the file', async () => {
    const zip = dummyZip();
    let hits = 0;
    const server = await startServer((_req, res) => {
      hits += 1;
      if (hits === 1) {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('temporarily unavailable');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/zip' });
      res.end(Buffer.from(zip));
    });

    try {
      const result = await downloadSkill(
        {
          id: 'dummy',
          name: 'Dummy',
          downloadUrl: `${server.baseUrl}/skill.zip`,
        },
        tmpDir,
        { scan: clean },
      );

      expect(result.success).toBe(true);
      expect(hits).toBe(2); // one 503, then the successful retry
      expect(fs.existsSync(skillFile())).toBe(true);
    } finally {
      await server.close();
    }
  });
  it('removes the skill and reports the scan step when the scan flags it', async () => {
    const zip = dummyZip();
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/zip' });
      res.end(Buffer.from(zip));
    });
    const captured = vi.spyOn(analytics, 'wizardCapture').mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      () => {},
    );

    try {
      const result = await downloadSkill(
        {
          id: 'dummy',
          name: 'Dummy',
          downloadUrl: `${server.baseUrl}/skill.zip`,
        },
        tmpDir,
        { scan: () => Promise.resolve('Poisoned skill detected: test-rule') },
      );

      expect(result).toEqual({
        success: false,
        error: 'Poisoned skill detected: test-rule',
      });
      expect(fs.existsSync(path.dirname(skillFile()))).toBe(false);
      expect(captured).toHaveBeenCalledWith(
        'skill install failed',
        expect.objectContaining({ step: 'scan', skill_id: 'dummy' }),
      );
    } finally {
      captured.mockRestore();
      await server.close();
    }
  });

  // The engine is WASM and has failed to instantiate in the field. Reported as
  // `extract` it reads as a corrupt archive, which the pure-JS unzip cannot
  // produce, and the run is told to check directory permissions instead.
  it('reports a scanner engine failure as the scan step, not extract', async () => {
    const zip = dummyZip();
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/zip' });
      res.end(Buffer.from(zip));
    });
    const captured = vi.spyOn(analytics, 'wizardCapture').mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      () => {},
    );

    try {
      const result = await downloadSkill(
        {
          id: 'dummy',
          name: 'Dummy',
          downloadUrl: `${server.baseUrl}/skill.zip`,
        },
        tmpDir,
        { scan: () => Promise.reject(new Error('WebAssembly.Module()')) },
      );

      expect(result.success).toBe(false);
      expect(captured).toHaveBeenCalledWith(
        'skill install failed',
        expect.objectContaining({ step: 'scan', skill_id: 'dummy' }),
      );
      // The files no scan read go with the folder the install made.
      expect(fs.existsSync(path.dirname(skillFile()))).toBe(false);
    } finally {
      captured.mockRestore();
      await server.close();
    }
  });

  // A menu id names the folder an install writes to.
  it.each(['../../outside', '..', 'a/b', '/tmp/x'])(
    'refuses the menu id %j, and fetches and writes nothing',
    async (id) => {
      let requests = 0;
      const server = await startServer((_req, res) => {
        requests += 1;
        res.writeHead(200, { 'Content-Type': 'application/zip' });
        res.end(Buffer.from(dummyZip()));
      });

      try {
        const result = await downloadSkill(
          { id, name: 'Dummy', downloadUrl: `${server.baseUrl}/skill.zip` },
          path.join(tmpDir, 'project'),
          { scan: clean },
        );

        expect(result).toEqual({
          success: false,
          error: `unusable skill id: ${id}`,
        });
        expect(requests).toBe(0);
        expect(fs.readdirSync(tmpDir)).toEqual([]);
      } finally {
        await server.close();
      }
    },
  );

  it('keeps a folder that was there first when the install fails', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    const notes = path.join(path.dirname(skillFile()), 'my-notes.md');
    fs.mkdirSync(path.dirname(notes), { recursive: true });
    fs.writeFileSync(notes, 'mine');

    try {
      const result = await downloadSkill(
        {
          id: 'dummy',
          name: 'Dummy',
          downloadUrl: `${server.baseUrl}/skill.zip`,
        },
        tmpDir,
        { scan: clean },
      );

      expect(result.success).toBe(false);
      expect(fs.readFileSync(notes, 'utf8')).toBe('mine');
    } finally {
      await server.close();
    }
  });
});

describe('removeRunSkills', () => {
  let dir: string;
  const skills = () => path.join(dir, '.claude', 'skills');
  const addSkill = (id: string, marked: boolean) => {
    fs.mkdirSync(path.join(skills(), id), { recursive: true });
    fs.writeFileSync(path.join(skills(), id, 'SKILL.md'), '# skill');
    if (marked)
      fs.writeFileSync(path.join(skills(), id, '.posthog-wizard'), '');
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-skills-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('removes the wizard skills a run added and keeps everything else', () => {
    addSkill('kept-from-last-run', true);
    addSkill('users-own', false);
    const before = listSkillFolders(dir);
    expect([...(before ?? [])].sort()).toEqual([
      'kept-from-last-run',
      'users-own',
    ]);

    addSkill('nextjs', true);
    addSkill('integration-nextjs', true);

    expect(removeRunSkills(dir, before).sort()).toEqual([
      'integration-nextjs',
      'nextjs',
    ]);
    expect(fs.readdirSync(skills()).sort()).toEqual([
      'kept-from-last-run',
      'users-own',
    ]);
  });

  it('removes the skills folder when the run left it empty', () => {
    const before = listSkillFolders(dir);
    addSkill('nextjs', true);

    removeRunSkills(dir, before);

    expect(fs.existsSync(skills())).toBe(false);
  });

  it('does nothing when the project has no skills folder', () => {
    expect(removeRunSkills(dir, new Set())).toEqual([]);
  });

  it('deletes nothing and does not throw when the skills folder is unreadable', () => {
    const before = listSkillFolders(dir);
    // A file where the folder should be makes readdirSync throw (ENOTDIR).
    fs.mkdirSync(path.dirname(skills()), { recursive: true });
    fs.writeFileSync(skills(), '');

    expect(listSkillFolders(dir)).toBeNull();
    expect(removeRunSkills(dir, before)).toEqual([]);
    expect(removeRunSkills(dir, null)).toEqual([]);
    expect(fs.existsSync(skills())).toBe(true);
  });

  it('keeps an unmarked folder the run installed a same-named skill into', () => {
    addSkill('integration-nextjs', false);
    const before = listSkillFolders(dir);
    fs.writeFileSync(
      path.join(skills(), 'integration-nextjs', '.posthog-wizard'),
      '',
    );

    expect(removeRunSkills(dir, before)).toEqual([]);
    expect(fs.existsSync(path.join(skills(), 'integration-nextjs'))).toBe(true);
  });

  it('deletes nothing when the skills folder links outside the project', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-outside-'));
    try {
      fs.mkdirSync(path.join(dir, '.claude'));
      fs.symlinkSync(outside, skills());
      const before = listSkillFolders(dir);
      fs.mkdirSync(path.join(outside, 'metrics-nodejs'));
      fs.writeFileSync(
        path.join(outside, 'metrics-nodejs', '.posthog-wizard'),
        '',
      );

      expect(before).toBeNull();
      expect(removeRunSkills(dir, new Set())).toEqual([]);
      expect(fs.existsSync(path.join(outside, 'metrics-nodejs'))).toBe(true);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  describe('with a skills folder linked inside the project', () => {
    const target = () => path.join(dir, '.agents', 'skills');
    const addSkill = (id: string, marked: boolean) => {
      fs.mkdirSync(path.join(target(), id), { recursive: true });
      if (marked) {
        fs.writeFileSync(path.join(target(), id, '.posthog-wizard'), '');
      }
    };

    beforeEach(() => {
      fs.mkdirSync(path.join(dir, '.claude'));
      fs.mkdirSync(target(), { recursive: true });
      fs.symlinkSync('../.agents/skills', skills());
    });

    it('removes the marked folder this run added', () => {
      const before = listSkillFolders(dir);
      addSkill('integration-javascript_web', true);

      expect(removeRunSkills(dir, before)).toEqual([
        'integration-javascript_web',
      ]);
      expect(
        fs.existsSync(path.join(target(), 'integration-javascript_web')),
      ).toBe(false);
    });

    it('keeps the project skills, the folder and the link', () => {
      addSkill('dev-env', false);
      addSkill('marked-before-the-run', true);
      const before = listSkillFolders(dir);
      addSkill('unmarked-from-the-run', false);
      addSkill('integration-javascript_web', true);

      removeRunSkills(dir, before);

      expect(fs.readdirSync(target()).sort()).toEqual([
        'dev-env',
        'marked-before-the-run',
        'unmarked-from-the-run',
      ]);
      expect(fs.lstatSync(skills()).isSymbolicLink()).toBe(true);
    });

    it('keeps the link when the run empties the folder', () => {
      const before = listSkillFolders(dir);
      addSkill('integration-javascript_web', true);

      removeRunSkills(dir, before);

      expect(fs.lstatSync(skills()).isSymbolicLink()).toBe(true);
      expect(fs.existsSync(target())).toBe(true);
    });
  });

  it('deletes nothing when the skills folder links to the project root', () => {
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.symlinkSync('..', skills());
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', '.posthog-wizard'), '');

    expect(listSkillFolders(dir)).toBeNull();
    expect(removeRunSkills(dir, new Set())).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'src'))).toBe(true);
  });

  it('leaves a symlinked skill entry and its target alone', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-outside-'));
    try {
      const before = listSkillFolders(dir);
      fs.writeFileSync(path.join(outside, '.posthog-wizard'), '');
      fs.mkdirSync(skills(), { recursive: true });
      fs.symlinkSync(outside, path.join(skills(), 'linked'));

      expect(removeRunSkills(dir, before)).toEqual([]);
      expect(fs.existsSync(path.join(outside, '.posthog-wizard'))).toBe(true);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
