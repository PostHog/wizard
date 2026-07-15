import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { zipSync } from 'fflate';
import {
  ASK_BATCH_THRESHOLD,
  DEFAULT_ASK_MAX_QUESTIONS,
  WIZARD_TOOL_NAMES,
  __test,
  downloadSkill,
  ensureGitignoreCoverage,
  evaluateAskCap,
  mergeEnvValues,
  parseEnvKeys,
  resolveEnvPath,
} from '@lib/wizard-tools';
import type { AuditCheck } from '@lib/programs/audit/types';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-tools-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

const seedChecks: AuditCheck[] = [
  {
    id: 'sdk-installed',
    area: 'Installation',
    label: 'PostHog SDK installed',
    status: 'pending',
  },
  {
    id: 'sdk-up-to-date',
    area: 'Installation',
    label: 'SDK up to date',
    status: 'pending',
  },
  {
    id: 'init-correct',
    area: 'Installation',
    label: 'Init is correct',
    status: 'pending',
  },
];

const extraChecks: AuditCheck[] = [
  {
    id: 'runtime-reviewed',
    area: 'Runtime',
    label: 'Runtime reviewed',
    status: 'pending',
  },
  {
    id: 'config-reviewed',
    area: 'Configuration',
    label: 'Configuration reviewed',
    status: 'pending',
  },
];

describe('resolveEnvPath', () => {
  it('resolves paths inside the working directory and rejects paths that escape it', () => {
    expect(resolveEnvPath('/project', '.env.local')).toBe(
      path.resolve('/project', '.env.local'),
    );
    expect(resolveEnvPath('/project', 'config/.env')).toBe(
      path.resolve('/project', 'config/.env'),
    );
    expect(resolveEnvPath('/project', '.')).toBe(path.resolve('/project'));
    expect(() => resolveEnvPath('/project', '../etc/passwd')).toThrow(
      'Path traversal rejected',
    );
    expect(() => resolveEnvPath('/project', '/etc/passwd')).toThrow(
      'Path traversal rejected',
    );
  });
});

describe('parseEnvKeys', () => {
  it('extracts keys from assignments while ignoring comments, blanks, and malformed lines', () => {
    const keys = parseEnvKeys(`
# COMMENT=ignored

FOO=bar
  BAR = "quoted"
MY_KEY_2='single quoted'
not a key value pair
DB_URL=postgres://host:5432/db?opt=1
`);

    expect(keys).toEqual(new Set(['FOO', 'BAR', 'MY_KEY_2', 'DB_URL']));
  });
});

describe('mergeEnvValues', () => {
  it('updates existing keys in place, appends new keys, and preserves values containing equals signs', () => {
    const result = mergeEnvValues('FOO=old\nDB_URL=old://host', {
      FOO: 'new',
      DB_URL: 'postgres://new:5432/db?opt=1',
      BAR: 'added',
    });

    expect(result).toBe(
      'FOO=new\nDB_URL=postgres://new:5432/db?opt=1\nBAR=added\n',
    );
  });
});

describe('ensureGitignoreCoverage', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => cleanup(tmpDir));

  it('creates or appends missing entries and does not duplicate trimmed matches', () => {
    ensureGitignoreCoverage(tmpDir, '.env.local');
    expect(fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8')).toBe(
      '.env.local\n',
    );

    ensureGitignoreCoverage(tmpDir, '.env.local');
    expect(fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8')).toBe(
      '.env.local\n',
    );

    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules');
    ensureGitignoreCoverage(tmpDir, '.env');
    expect(fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8')).toBe(
      'node_modules\n.env\n',
    );

    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '  .env.local  \n');
    ensureGitignoreCoverage(tmpDir, '.env.local');
    expect(fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8')).toBe(
      '  .env.local  \n',
    );
  });
});

describe('audit ledger helpers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => cleanup(tmpDir));

  it('writes, replaces, and reads a ledger without leaving temporary files behind', () => {
    const target = path.join(tmpDir, __test.AUDIT_CHECKS_FILE);

    __test.writeLedgerAtomic(target, seedChecks);
    expect(__test.readLedger(target)).toEqual(seedChecks);
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);

    __test.writeLedgerAtomic(target, [seedChecks[0]]);
    expect(__test.readLedger(target)).toEqual([seedChecks[0]]);
  });

  it('treats missing or invalid ledger files as empty ledgers', () => {
    expect(__test.readLedger(path.join(tmpDir, 'missing.json'))).toEqual([]);

    const target = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(target, '{not json');
    expect(__test.readLedger(target)).toEqual([]);
  });

  it('patches known checks with metadata and reports unknown check ids without changing the ledger', () => {
    const { next, unknown } = __test.applyAuditUpdates(seedChecks, [
      {
        id: 'sdk-installed',
        status: 'pass',
        file: 'package.json',
        details: 'posthog-js found',
      },
      { id: 'does-not-exist', status: 'warning' },
    ]);

    expect(unknown).toEqual(['does-not-exist']);
    expect(next).toEqual([
      {
        ...seedChecks[0],
        status: 'pass',
        file: 'package.json',
        details: 'posthog-js found',
      },
      seedChecks[1],
      seedChecks[2],
    ]);
  });

  it('appends new checks after existing checks and rejects duplicates without mutating', () => {
    expect(
      __test.applyAuditAdditions(seedChecks, extraChecks).next.map((c) => c.id),
    ).toEqual([
      'sdk-installed',
      'sdk-up-to-date',
      'init-correct',
      'runtime-reviewed',
      'config-reviewed',
    ]);

    const duplicateExisting = __test.applyAuditAdditions(seedChecks, [
      { ...extraChecks[0], id: 'sdk-installed' },
    ]);
    expect(duplicateExisting).toEqual({
      next: seedChecks,
      duplicates: ['sdk-installed'],
    });

    const duplicateAddition = __test.applyAuditAdditions(seedChecks, [
      extraChecks[0],
      { ...extraChecks[1], id: extraChecks[0].id },
    ]);
    expect(duplicateAddition).toEqual({
      next: seedChecks,
      duplicates: ['runtime-reviewed'],
    });
  });

  it('requires a seeded on-disk ledger before appending checks', () => {
    const target = path.join(tmpDir, __test.AUDIT_CHECKS_FILE);

    expect(__test.appendAuditChecksToLedger(target, extraChecks)).toEqual({
      ok: false,
      reason: 'missing-ledger',
    });
    expect(fs.existsSync(target)).toBe(false);
  });

  it('appends checks to disk and rejects duplicate ids without changing the existing file', () => {
    const target = path.join(tmpDir, __test.AUDIT_CHECKS_FILE);
    __test.writeLedgerAtomic(target, seedChecks);

    expect(__test.appendAuditChecksToLedger(target, extraChecks)).toEqual({
      ok: true,
      added: 2,
    });
    expect(__test.readLedger(target)).toEqual([...seedChecks, ...extraChecks]);

    expect(
      __test.appendAuditChecksToLedger(target, [
        { ...extraChecks[0], id: 'sdk-installed' },
      ]),
    ).toEqual({
      ok: false,
      reason: 'duplicate-ids',
      ids: ['sdk-installed'],
    });
    expect(__test.readLedger(target)).toEqual([...seedChecks, ...extraChecks]);
  });
});

describe('makeMutex', () => {
  it('serializes concurrent ledger add and resolve operations without losing either change', async () => {
    const tmpDir = makeTmpDir();
    try {
      const target = path.join(tmpDir, __test.AUDIT_CHECKS_FILE);
      __test.writeLedgerAtomic(target, seedChecks);

      const run = __test.makeMutex();
      await Promise.all([
        run(() => {
          const current = __test.readLedger(target);
          const { next } = __test.applyAuditUpdates(current, [
            { id: 'sdk-installed', status: 'pass' },
          ]);
          __test.writeLedgerAtomic(target, next);
        }),
        run(() => {
          __test.appendAuditChecksToLedger(target, [extraChecks[0]]);
        }),
      ]);

      const final = __test.readLedger(target);
      expect(final.find((c) => c.id === 'sdk-installed')?.status).toBe('pass');
      expect(final.find((c) => c.id === extraChecks[0].id)).toEqual(
        extraChecks[0],
      );
    } finally {
      cleanup(tmpDir);
    }
  });

  it('continues running queued tasks after a previous task fails', async () => {
    const run = __test.makeMutex();

    await expect(
      run(() => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(run(() => 42)).resolves.toBe(42);
  });
});

describe('WIZARD_TOOL_NAMES', () => {
  it('exposes audit_add_checks so future programs can append checks through the MCP server', () => {
    expect(WIZARD_TOOL_NAMES.auditAddChecks).toBe(
      'mcp__wizard-tools__audit_add_checks',
    );
  });

  it('exposes wizard_ask so skills can collect structured input from the user', () => {
    expect(WIZARD_TOOL_NAMES.wizardAsk).toBe('mcp__wizard-tools__wizard_ask');
  });
});

describe('evaluateAskCap', () => {
  const MAX = DEFAULT_ASK_MAX_QUESTIONS;

  it('allows calls under both the adjacency threshold and the max cap', () => {
    for (let i = 0; i < ASK_BATCH_THRESHOLD; i++) {
      expect(evaluateAskCap(i, MAX)).toEqual({ kind: 'ok' });
    }
  });

  it('returns the adjacency error once the threshold is hit', () => {
    expect(evaluateAskCap(ASK_BATCH_THRESHOLD, MAX)).toEqual({
      kind: 'capped',
      reason: 'adjacency',
      message: expect.stringMatching(/batch/i),
    });
  });

  it('fires the adjacency nudge only once — later calls proceed up to the cap', () => {
    // After the nudge is recorded, calls between the threshold and the cap
    // go through; otherwise caps above the threshold would be unreachable.
    for (let i = ASK_BATCH_THRESHOLD; i < MAX; i++) {
      expect(evaluateAskCap(i, MAX, true)).toEqual({ kind: 'ok' });
    }
    expect(evaluateAskCap(MAX, MAX, true)).toEqual({
      kind: 'capped',
      reason: 'max_questions',
      message: expect.stringMatching(/cap reached/i),
    });
  });

  it('escalates to the max_questions reason once the cap is reached', () => {
    expect(evaluateAskCap(MAX, MAX)).toEqual({
      kind: 'capped',
      reason: 'max_questions',
      message: expect.stringMatching(/cap reached/i),
    });
  });

  it('honors a custom maxQuestions override smaller than the adjacency threshold', () => {
    // With maxQuestions=2 (below ASK_BATCH_THRESHOLD), the per-run cap wins.
    expect(evaluateAskCap(2, 2)).toEqual({
      kind: 'capped',
      reason: 'max_questions',
      message: expect.any(String),
    });
  });
});

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

  it('reports every attempt when all retries fail', async () => {
    await expect(
      __test.downloadWithRetry(url, {
        fetchImpl: (() => Promise.reject(new Error('network down'))) as any,
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
