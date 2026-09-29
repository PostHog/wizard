import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { zipSync } from 'fflate';
import { __test, downloadSkill } from '@shared/skill-install';

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
});

describe('extractBundle', () => {
  let dest: string;

  const bundle = (files: Record<string, string>) => ({
    id: 'integration-v2-capture',
    variants: { django: files },
  });

  beforeEach(() => {
    dest = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-bundle-'));
  });

  afterEach(() => {
    cleanup(dest);
  });

  it('writes only the named variant, including nested paths', () => {
    const written = __test.extractBundle(
      bundle({ 'SKILL.md': '# skill', 'references/deep/notes.md': 'notes' }),
      dest,
      'integration-v2-capture-django',
    );

    expect(written).toBe(2);
    expect(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8')).toBe(
      '# skill',
    );
    expect(
      fs.readFileSync(path.join(dest, 'references/deep/notes.md'), 'utf8'),
    ).toBe('notes');
  });

  it('rejects entries that escape the destination', () => {
    expect(() =>
      __test.extractBundle(
        bundle({ '../evil.txt': 'pwned' }),
        dest,
        'integration-v2-capture-django',
      ),
    ).toThrow(/escapes destination/);
    expect(fs.existsSync(path.join(dest, '..', 'evil.txt'))).toBe(false);
  });

  it('rejects absolute entry paths', () => {
    expect(() =>
      __test.extractBundle(
        bundle({ '/etc/evil.txt': 'pwned' }),
        dest,
        'integration-v2-capture-django',
      ),
    ).toThrow(/escapes destination/);
  });

  it('throws when the bundle lacks the named variant', () => {
    expect(() =>
      __test.extractBundle(
        bundle({ 'SKILL.md': '# skill' }),
        dest,
        'integration-v2-capture-nextjs',
      ),
    ).toThrow(/has no variant/);
  });

  it('throws a clean error on JSON that is not a bundle', () => {
    for (const malformed of [
      null,
      [],
      'oops',
      { id: 'x' },
      { variants: {} },
      { id: 'x', variants: null },
    ]) {
      expect(() =>
        __test.extractBundle(
          malformed as never,
          dest,
          'integration-v2-capture-django',
        ),
      ).toThrow(/malformed bundle/);
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
      );

      expect(result.success).toBe(true);
      expect(hits).toBe(2); // one 503, then the successful retry
      expect(fs.existsSync(skillFile())).toBe(true);
    } finally {
      await server.close();
    }
  });
});
