import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { zipSync } from 'fflate';
import {
  ASK_BATCH_THRESHOLD,
  DEFAULT_ASK_MAX_QUESTIONS,
  WIZARD_TOOL_NAMES,
  __test,
  CHECK_ENV_KEYS_DESCRIPTION,
  checkEnvKeys,
  ensureGitignoreCoverage,
  evaluateAskCap,
  fetchSkillMenu,
  mergeEnvValues,
  parseEnvKeys,
  resolveEnvPath,
  templateEnvWriteRefusal,
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

describe('checkEnvKeys', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  function writeEnv(relativePath: string, content: string): void {
    const full = path.join(tmpDir, relativePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  describe('project scan (no filePath)', () => {
    it.each([
      ['.env'],
      ['.env.local'],
      ['.env.production'],
      ['apps/api/.env'],
      ['apps/web/.env.local'],
    ])('reports a key in %s as present and names the file', (relativePath) => {
      writeEnv(relativePath, 'OPENAI_API_KEY=sk-live-secret\n');

      expect(checkEnvKeys(tmpDir, ['OPENAI_API_KEY'])).toEqual({
        OPENAI_API_KEY: { status: 'present', foundIn: [relativePath] },
      });
    });

    it('agrees with the detector: a key only in a nested .env.local is present', () => {
      // The mismatch this tool used to produce — the detector saw the key in
      // apps/api/.env.local while the tool looked only at .env.
      writeEnv('apps/api/.env.local', 'ANTHROPIC_API_KEY=sk-ant-secret\n');
      writeEnv('.env', 'UNRELATED=1\n');

      const result = checkEnvKeys(tmpDir, ['ANTHROPIC_API_KEY']);
      expect(result.ANTHROPIC_API_KEY.status).toBe('present');
      expect(result.ANTHROPIC_API_KEY.foundIn).toEqual(['apps/api/.env.local']);
    });

    it('reports a key defined nowhere as missing with no files', () => {
      writeEnv('.env', 'OTHER=1\n');
      expect(checkEnvKeys(tmpDir, ['NOPE'])).toEqual({
        NOPE: { status: 'missing', foundIn: [] },
      });
    });

    it.each(['.env.example', '.env.sample', '.env.template', '.env.dist'])(
      'does not call a key present when only %s declares it',
      (template) => {
        // Nearly every project commits one of these, and they hold empty
        // placeholders. Counting them as "present" tells the agent the
        // credential is already configured, so it never collects one — the
        // mirror image of the "missing" answer this tool was fixed to stop
        // giving.
        writeEnv(template, 'OPENAI_API_KEY=\nDATABASE_URL=\n');

        const result = checkEnvKeys(tmpDir, ['OPENAI_API_KEY']);
        expect(result.OPENAI_API_KEY.status).toBe('missing');
        // Still named, as evidence that the project expects the key — NOT as a
        // write target. A template is committed, so a credential written there
        // would be published; the description says so explicitly.
        expect(result.OPENAI_API_KEY.foundIn).toEqual([template]);
      },
    );

    it('warns that a template is never a write target', () => {
      // `foundIn` hands the agent a path, and `set_env_values` will happily
      // write to a template and then "protect" it by gitignoring a file git is
      // already tracking. The only thing standing between that and a published
      // credential is this sentence, so pin it.
      expect(CHECK_ENV_KEYS_DESCRIPTION).toMatch(/NEVER a write target/);
      expect(CHECK_ENV_KEYS_DESCRIPTION).toMatch(/would publish it/);
    });

    it('is present when a real file sets a key the template also declares', () => {
      writeEnv('.env.example', 'DATABASE_URL=\n');
      writeEnv('.env', 'DATABASE_URL=postgres://u:pw@h/db\n');

      const result = checkEnvKeys(tmpDir, ['DATABASE_URL']);
      expect(result.DATABASE_URL.status).toBe('present');
      expect(result.DATABASE_URL.foundIn).toEqual(
        expect.arrayContaining(['.env', '.env.example']),
      );
    });

    it('treats .env.example.local as a real file, not a template', () => {
      // Only the four conventional template names are discounted; anything
      // else that starts with `.env` is somebody's real environment.
      writeEnv('.env.example.local', 'STRIPE_SECRET_KEY=sk_live_x\n');

      expect(checkEnvKeys(tmpDir, ['STRIPE_SECRET_KEY'])).toEqual({
        STRIPE_SECRET_KEY: {
          status: 'present',
          foundIn: ['.env.example.local'],
        },
      });
    });

    it('reports every file that defines the same key', () => {
      writeEnv('.env', 'SHARED=a\n');
      writeEnv('apps/api/.env', 'SHARED=b\n');

      const result = checkEnvKeys(tmpDir, ['SHARED']);
      expect(result.SHARED.status).toBe('present');
      expect(result.SHARED.foundIn).toHaveLength(2);
      expect(result.SHARED.foundIn).toEqual(
        expect.arrayContaining(['.env', 'apps/api/.env']),
      );
    });

    it('reads the `export KEY=` form', () => {
      writeEnv('.env.local', 'export STRIPE_SECRET_KEY=sk_live_x\n');
      expect(
        checkEnvKeys(tmpDir, ['STRIPE_SECRET_KEY']).STRIPE_SECRET_KEY,
      ).toEqual({ status: 'present', foundIn: ['.env.local'] });
    });

    it('does not crash when .env is a directory', () => {
      fs.mkdirSync(path.join(tmpDir, '.env'));
      fs.writeFileSync(
        path.join(tmpDir, '.env', 'pyvenv.cfg'),
        'home = /usr\n',
      );
      writeEnv('.env.local', 'STRIPE_SECRET_KEY=sk_live_x\n');

      expect(
        checkEnvKeys(tmpDir, ['STRIPE_SECRET_KEY']).STRIPE_SECRET_KEY,
      ).toEqual({ status: 'present', foundIn: ['.env.local'] });
    });

    it('ignores env files below the depth limit and inside node_modules', () => {
      writeEnv('a/b/c/d/.env', 'TOO_DEEP=x\n');
      writeEnv('node_modules/pkg/.env', 'VENDORED=x\n');
      writeEnv('a/b/c/.env', 'IN_RANGE=x\n');

      expect(
        checkEnvKeys(tmpDir, ['TOO_DEEP', 'VENDORED', 'IN_RANGE']),
      ).toEqual({
        TOO_DEEP: { status: 'missing', foundIn: [] },
        VENDORED: { status: 'missing', foundIn: [] },
        IN_RANGE: { status: 'present', foundIn: ['a/b/c/.env'] },
      });
    });

    it('returns an empty answer for a project with no env files', () => {
      expect(checkEnvKeys(tmpDir, ['ANY'])).toEqual({
        ANY: { status: 'missing', foundIn: [] },
      });
    });
  });

  describe('single-file mode (filePath given)', () => {
    it('checks only the named file', () => {
      writeEnv('.env', 'IN_ROOT=x\n');
      writeEnv('apps/api/.env', 'IN_NESTED=x\n');

      expect(checkEnvKeys(tmpDir, ['IN_ROOT', 'IN_NESTED'], '.env')).toEqual({
        IN_ROOT: { status: 'present', foundIn: ['.env'] },
        IN_NESTED: { status: 'missing', foundIn: [] },
      });
    });

    it('resolves a nested path relative to the working directory', () => {
      writeEnv('apps/api/.env.local', 'NESTED_KEY=x\n');

      expect(
        checkEnvKeys(tmpDir, ['NESTED_KEY'], 'apps/api/.env.local'),
      ).toEqual({
        NESTED_KEY: { status: 'present', foundIn: ['apps/api/.env.local'] },
      });
    });

    it('reports every key as missing when the file does not exist', () => {
      expect(checkEnvKeys(tmpDir, ['A', 'B'], '.env.local')).toEqual({
        A: { status: 'missing', foundIn: [] },
        B: { status: 'missing', foundIn: [] },
      });
    });

    it('reports missing instead of crashing when the path is a directory', () => {
      // Regression guard: `.env` as a Python virtualenv threw EISDIR.
      fs.mkdirSync(path.join(tmpDir, '.env'));

      expect(() => checkEnvKeys(tmpDir, ['ANY'], '.env')).not.toThrow();
      expect(checkEnvKeys(tmpDir, ['ANY'], '.env')).toEqual({
        ANY: { status: 'missing', foundIn: [] },
      });
    });

    it('still rejects a path that escapes the working directory', () => {
      expect(() => checkEnvKeys(tmpDir, ['ANY'], '../../etc/passwd')).toThrow(
        'Path traversal rejected',
      );
    });

    it('discounts a template even when the caller names it explicitly', () => {
      // `status` has to mean the same thing in both modes, or an agent that
      // passes a path gets a different answer from one that does not. The
      // file is still named in `foundIn`, so the answer is not opaque.
      writeEnv('.env.example', 'OPENAI_API_KEY=\n');

      expect(checkEnvKeys(tmpDir, ['OPENAI_API_KEY'], '.env.example')).toEqual({
        OPENAI_API_KEY: { status: 'missing', foundIn: ['.env.example'] },
      });
    });
  });

  describe('the values-never-returned guarantee', () => {
    const secrets = [
      'sk-live-supersecret',
      'postgres://user:hunter2@db.internal:5432/app',
      'AKIAIOSFODNN7EXAMPLE',
    ];

    it.each([[undefined], ['.env.local']])(
      'returns key names and paths only (filePath=%s)',
      (filePath) => {
        writeEnv(
          '.env.local',
          [
            `OPENAI_API_KEY=${secrets[0]}`,
            `DATABASE_URL=${secrets[1]}`,
            `AWS_ACCESS_KEY_ID=${secrets[2]}`,
          ].join('\n'),
        );

        const serialized = JSON.stringify(
          checkEnvKeys(
            tmpDir,
            ['OPENAI_API_KEY', 'DATABASE_URL', 'AWS_ACCESS_KEY_ID'],
            filePath,
          ),
        );

        expect(serialized).toContain('OPENAI_API_KEY');
        expect(serialized).toContain('.env.local');
        for (const secret of secrets) {
          expect(serialized).not.toContain(secret);
        }
      },
    );
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

  it('updates an `export KEY=` line in place, keeping the prefix', () => {
    // check_env_keys reads this form and reports the key present. A writer
    // that could not see it appended a second definition below, leaving two
    // declarations of one key and the winner up to the app's dotenv loader.
    expect(
      mergeEnvValues('export STRIPE_SECRET_KEY=sk_live_old\n', {
        STRIPE_SECRET_KEY: 'sk_live_new',
      }),
    ).toBe('export STRIPE_SECRET_KEY=sk_live_new\n');
  });

  it('handles an indented `export` and leaves neighbouring lines alone', () => {
    expect(
      mergeEnvValues('KEEP=me\n  export FOO=old\nALSO=kept\n', { FOO: 'new' }),
    ).toBe('KEEP=me\n  export FOO=new\nALSO=kept\n');
  });

  it('does not treat a commented-out export as the live declaration', () => {
    expect(mergeEnvValues('# export FOO=old\n', { FOO: 'new' })).toBe(
      '# export FOO=old\nFOO=new\n',
    );
  });

  it('does not let a key with regex metacharacters overwrite another line', () => {
    // The key is interpolated into the match pattern. Unescaped, `A|B` builds
    // "any line starting with A" and the merge rewrites that line's value.
    const result = mergeEnvValues('ALPHA=keep-me\n', { 'A|B': 'x' });

    expect(result).toContain('ALPHA=keep-me');
    expect(result).not.toContain('ALPHA=x');
  });
});

describe('templateEnvWriteRefusal', () => {
  it.each(['.env.example', '.env.sample', '.env.template', '.env.dist'])(
    'refuses %s as a set_env_values target',
    (name) => {
      const refusal = templateEnvWriteRefusal(`/project/${name}`);
      expect(refusal).toContain(name);
      expect(refusal).toMatch(/would be published/);
      // The agent needs somewhere to go, or it will just retry the same path.
      expect(refusal).toMatch(/\.env\.local/);
    },
  );

  it.each(['.env', '.env.local', '.env.production', '.env.example.local'])(
    'allows %s',
    (name) => {
      expect(templateEnvWriteRefusal(`/project/${name}`)).toBeNull();
    },
  );

  it('judges the basename, not the directory it sits in', () => {
    expect(templateEnvWriteRefusal('/project/.env.example/.env')).toBeNull();
    expect(
      templateEnvWriteRefusal('/project/apps/api/.env.example'),
    ).not.toBeNull();
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

  it('returns the adjacency nudge once the threshold is hit', () => {
    expect(evaluateAskCap(ASK_BATCH_THRESHOLD, MAX)).toEqual({
      kind: 'capped',
      reason: 'adjacency',
      message: expect.stringMatching(/batch/i),
    });
  });

  it('frames the adjacency nudge as retryable, not a refusal', () => {
    // Agents abandon the source to browser fallback when this reads as a hard
    // error — it must not start with "Error" and must say the ask can be re-sent.
    const decision = evaluateAskCap(ASK_BATCH_THRESHOLD, MAX);
    if (decision.kind !== 'capped') throw new Error('expected capped');
    expect(decision.message).not.toMatch(/^Error/);
    expect(decision.message).toMatch(/not an error/i);
    expect(decision.message).toMatch(/not sent|again/i);
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

  it('reports every attempt when all retries fail', async () => {
    await expect(
      __test.downloadWithRetry(url, {
        fetchImpl: (() => Promise.reject(new Error('network down'))) as any,
        sleepImpl: noSleep,
        maxAttempts: 3,
      }),
    ).rejects.toThrow(/attempt 1.*attempt 2.*attempt 3/s);
  });
});

describe('fetchSkillMenu', () => {
  const noSleep = () => Promise.resolve();
  const menu = { categories: { integration: [] } };
  const menuResponse = () =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(menu),
    });

  it('retries a flaky menu fetch before succeeding', async () => {
    let attempts = 0;

    const result = await fetchSkillMenu('http://localhost:8765', {
      fetchImpl: (() => {
        attempts += 1;
        if (attempts < 3) return Promise.reject(new Error('reset'));
        return menuResponse();
      }) as any,
      sleepImpl: noSleep,
    });

    expect(attempts).toBe(3);
    expect(result).toEqual(menu);
  });

  it('returns null after exhausting retries', async () => {
    let attempts = 0;

    const result = await fetchSkillMenu('http://localhost:8765', {
      fetchImpl: (() => {
        attempts += 1;
        return Promise.reject(new Error('network down'));
      }) as any,
      sleepImpl: noSleep,
      maxAttempts: 3,
    });

    expect(attempts).toBe(3);
    expect(result).toBeNull();
  });
});
