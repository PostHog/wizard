import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { zipSync } from 'fflate';
import {
  ASK_BATCH_THRESHOLD,
  ASK_SUBJECT_UNSPECIFIED,
  DEFAULT_ASK_MAX_QUESTIONS,
  WIZARD_ASK_SUBJECT_DESCRIPTION,
  WIZARD_ASK_TOOL_DESCRIPTION,
  WIZARD_TOOL_NAMES,
  __test,
  createAskAccounting,
  ensureGitignoreCoverage,
  evaluateAskCap,
  fetchSkillMenu,
  mergeEnvValues,
  normaliseAskSubject,
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

describe('normaliseAskSubject', () => {
  it('collapses an absent, blank or whitespace subject to one shared key', () => {
    for (const raw of [undefined, '', '   ', '\n\t']) {
      expect(normaliseAskSubject(raw)).toBe(ASK_SUBJECT_UNSPECIFIED);
    }
  });

  it('folds case and surrounding whitespace so one source is one subject', () => {
    expect(normaliseAskSubject('Postgres')).toBe('postgres');
    expect(normaliseAskSubject('  POSTGRES  ')).toBe('postgres');
    expect(normaliseAskSubject('postgres')).toBe('postgres');
  });

  it('truncates instead of rejecting an over-long subject', () => {
    // A rejected subject would fail the whole ask; the agent must never lose a
    // credential prompt because it wrote a verbose tag.
    const long = 'x'.repeat(200);
    expect(normaliseAskSubject(long)).toHaveLength(60);
  });
});

describe('evaluateAskCap', () => {
  const MAX = DEFAULT_ASK_MAX_QUESTIONS;
  const at = (over: Partial<Parameters<typeof evaluateAskCap>[0]>) =>
    evaluateAskCap({
      callCount: 0,
      maxQuestions: MAX,
      subject: 'postgres',
      subjectRunLength: 0,
      ...over,
    });

  it('allows calls under both the adjacency threshold and the max cap', () => {
    for (let i = 0; i < ASK_BATCH_THRESHOLD; i++) {
      expect(at({ callCount: i, subjectRunLength: i })).toEqual({ kind: 'ok' });
    }
  });

  it('returns the adjacency nudge once one subject repeats to the threshold', () => {
    expect(
      at({
        callCount: ASK_BATCH_THRESHOLD,
        subjectRunLength: ASK_BATCH_THRESHOLD,
      }),
    ).toEqual({
      kind: 'capped',
      reason: 'adjacency',
      subject: 'postgres',
      subjectRunLength: ASK_BATCH_THRESHOLD,
      message: expect.stringMatching(/batch/i),
    });
  });

  it('never nudges a call whose subject run is still short, however many calls ran', () => {
    // The warehouse task asks once per detected source: many calls, run
    // length 0 every time. It must never be interrupted.
    for (let i = 0; i < MAX; i++) {
      expect(at({ callCount: i, subjectRunLength: 0 })).toEqual({ kind: 'ok' });
    }
  });

  it('frames the adjacency nudge as retryable, not a refusal', () => {
    // Agents abandon the source to browser fallback when this reads as a hard
    // error — it must not start with "Error" and must say the ask can be re-sent.
    const decision = at({ subjectRunLength: ASK_BATCH_THRESHOLD });
    if (decision.kind !== 'capped') throw new Error('expected capped');
    expect(decision.message).not.toMatch(/^Error/);
    expect(decision.message).toMatch(/not an error/i);
    expect(decision.message).toMatch(/not sent|again/i);
    expect(decision.message).toMatch(/do not abandon the task/i);
  });

  it('tells the agent to re-tag rather than to squeeze sources into one call', () => {
    // The old message told the agent to fit every remaining question into a
    // single 8-question call. With 5 sources left that is arithmetically
    // impossible, so the agent fell back to browser links instead.
    const decision = at({ subjectRunLength: ASK_BATCH_THRESHOLD });
    if (decision.kind !== 'capped') throw new Error('expected capped');
    expect(decision.message).toMatch(/different `subject`/);
    expect(decision.message).toMatch(/per subject/i);
    expect(decision.message).toMatch(/one call per source is never blocked/i);
  });

  it('names the repeated subject so the agent knows which one to batch', () => {
    const decision = at({ subject: 'stripe', subjectRunLength: 4 });
    if (decision.kind !== 'capped') throw new Error('expected capped');
    expect(decision.message).toContain('"stripe"');
    expect(decision.message).toContain('4 wizard_ask calls in a row');
  });

  it('explains the missing-subject case instead of quoting a placeholder', () => {
    const decision = at({
      subject: ASK_SUBJECT_UNSPECIFIED,
      subjectRunLength: ASK_BATCH_THRESHOLD,
    });
    if (decision.kind !== 'capped') throw new Error('expected capped');
    expect(decision.message).toMatch(/declared no `subject`/);
    expect(decision.message).not.toContain(`"${ASK_SUBJECT_UNSPECIFIED}"`);
  });

  it('fires the adjacency nudge only once — later calls proceed up to the cap', () => {
    // After the nudge is recorded, calls between the threshold and the cap
    // go through; otherwise caps above the threshold would be unreachable.
    for (let i = ASK_BATCH_THRESHOLD; i < MAX; i++) {
      expect(
        at({ callCount: i, subjectRunLength: i, adjacencyNudged: true }),
      ).toEqual({ kind: 'ok' });
    }
    expect(
      at({ callCount: MAX, subjectRunLength: MAX, adjacencyNudged: true }),
    ).toMatchObject({ kind: 'capped', reason: 'max_questions' });
  });

  it('escalates to the max_questions reason once the cap is reached', () => {
    expect(at({ callCount: MAX })).toEqual({
      kind: 'capped',
      reason: 'max_questions',
      subject: 'postgres',
      subjectRunLength: 0,
      message: expect.stringMatching(/cap reached/i),
    });
  });

  it('keeps the per-run cap hard even when every call has a fresh subject', () => {
    // Subjects relax adjacency only. They must never widen the run budget.
    expect(at({ callCount: MAX, subjectRunLength: 0 })).toMatchObject({
      kind: 'capped',
      reason: 'max_questions',
    });
  });

  it('honors a custom maxQuestions override smaller than the adjacency threshold', () => {
    // With maxQuestions=2 (below ASK_BATCH_THRESHOLD), the per-run cap wins.
    expect(
      at({ callCount: 2, maxQuestions: 2, subjectRunLength: 2 }),
    ).toMatchObject({ kind: 'capped', reason: 'max_questions' });
  });
});

describe('createAskAccounting', () => {
  const MAX = DEFAULT_ASK_MAX_QUESTIONS;

  /** Send `n` calls for `subject`, asserting each was allowed through. */
  const sendAllowed = (
    acc: ReturnType<typeof createAskAccounting>,
    subject: string | undefined,
    n: number,
  ) => {
    for (let i = 0; i < n; i++) {
      expect(acc.evaluate(subject)).toEqual({ kind: 'ok' });
      acc.record(subject);
    }
  };

  it('lets a five-source warehouse run ask once per source without a nudge', () => {
    // The exact shape the telemetry showed failing: 5 in-cli sources, one
    // batched credential call each. Every call must go through.
    const acc = createAskAccounting(MAX);
    sendAllowed(acc, 'Postgres', 1);
    sendAllowed(acc, 'Stripe', 1);
    sendAllowed(acc, 'MySQL', 1);
    sendAllowed(acc, 'Hubspot', 1);
    sendAllowed(acc, 'Snowflake', 1);
    expect(acc.snapshot()).toMatchObject({
      callCount: 5,
      subjectRunLength: 1,
      adjacencyNudged: false,
    });
  });

  it('still nudges an agent that machine-guns one subject', () => {
    const acc = createAskAccounting(MAX);
    sendAllowed(acc, 'Postgres', ASK_BATCH_THRESHOLD);
    const decision = acc.evaluate('Postgres');
    expect(decision).toMatchObject({ kind: 'capped', reason: 'adjacency' });
  });

  it('still nudges an agent that declares no subject at all', () => {
    // The guard's original run-wide behaviour is the default, so an agent that
    // opts out of subjects gains nothing.
    const acc = createAskAccounting(MAX);
    sendAllowed(acc, undefined, ASK_BATCH_THRESHOLD);
    expect(acc.evaluate(undefined)).toMatchObject({
      kind: 'capped',
      reason: 'adjacency',
      subject: ASK_SUBJECT_UNSPECIFIED,
    });
  });

  it('treats differently-cased spellings of one subject as the same run', () => {
    const acc = createAskAccounting(MAX);
    sendAllowed(acc, 'Postgres', 1);
    sendAllowed(acc, ' postgres ', 1);
    sendAllowed(acc, 'POSTGRES', 1);
    expect(acc.evaluate('postgres')).toMatchObject({
      kind: 'capped',
      reason: 'adjacency',
    });
  });

  it('resets the run when a different subject interleaves', () => {
    const acc = createAskAccounting(MAX);
    sendAllowed(acc, 'Postgres', 2);
    sendAllowed(acc, 'Stripe', 1);
    sendAllowed(acc, 'Postgres', 2);
    expect(acc.snapshot()).toMatchObject({
      subject: 'postgres',
      subjectRunLength: 2,
      adjacencyNudged: false,
    });
  });

  it('does not advance the run for a call the nudge blocked', () => {
    // The blocked call never reached the user, so it must not count.
    const acc = createAskAccounting(MAX);
    sendAllowed(acc, 'Postgres', ASK_BATCH_THRESHOLD);
    expect(acc.evaluate('Postgres')).toMatchObject({ reason: 'adjacency' });
    expect(acc.snapshot()).toMatchObject({
      callCount: ASK_BATCH_THRESHOLD,
      subjectRunLength: ASK_BATCH_THRESHOLD,
      adjacencyNudged: true,
    });
  });

  it('fires the nudge once per run, then lets the same subject through', () => {
    const acc = createAskAccounting(MAX);
    sendAllowed(acc, 'Postgres', ASK_BATCH_THRESHOLD);
    expect(acc.evaluate('Postgres')).toMatchObject({ reason: 'adjacency' });
    sendAllowed(acc, 'Postgres', 1);
    expect(acc.evaluate('Postgres')).toEqual({ kind: 'ok' });
  });

  it('refunds a cancelled ask on both the run total and the subject run', () => {
    // The skill promises a declined ask is free. A refund that only rolled back
    // the total would still push the subject towards the nudge.
    const acc = createAskAccounting(MAX);
    sendAllowed(acc, 'Postgres', 1);
    acc.record('Postgres');
    acc.refund('Postgres');
    expect(acc.snapshot()).toMatchObject({
      callCount: 1,
      subjectRunLength: 1,
    });
  });

  it('never lets repeated cancellations exhaust the per-run cap', () => {
    const acc = createAskAccounting(2);
    for (let i = 0; i < 20; i++) {
      expect(acc.evaluate('Postgres')).toEqual({ kind: 'ok' });
      acc.record('Postgres');
      acc.refund('Postgres');
    }
    expect(acc.snapshot()).toMatchObject({ callCount: 0, subjectRunLength: 0 });
  });

  it('clamps a refund that has nothing left to refund', () => {
    const acc = createAskAccounting(MAX);
    acc.refund('Postgres');
    acc.refund('Postgres');
    expect(acc.snapshot()).toMatchObject({ callCount: 0, subjectRunLength: 0 });
  });

  it('refunds only the subject it was given', () => {
    const acc = createAskAccounting(MAX);
    sendAllowed(acc, 'Postgres', 2);
    acc.refund('Stripe');
    expect(acc.snapshot()).toMatchObject({
      callCount: 1,
      subject: 'postgres',
      subjectRunLength: 2,
    });
  });

  it('stops the run at maxQuestions however many subjects were used', () => {
    const acc = createAskAccounting(4);
    sendAllowed(acc, 'Postgres', 1);
    sendAllowed(acc, 'Stripe', 1);
    sendAllowed(acc, 'MySQL', 1);
    sendAllowed(acc, 'Hubspot', 1);
    expect(acc.evaluate('Snowflake')).toMatchObject({
      kind: 'capped',
      reason: 'max_questions',
    });
  });
});

describe('wizard_ask shared descriptions', () => {
  it('tells the agent that walking a list is expected, not capped', () => {
    expect(WIZARD_ASK_TOOL_DESCRIPTION).toMatch(/`subject`/);
    expect(WIZARD_ASK_TOOL_DESCRIPTION).toMatch(/per subject/i);
    expect(WIZARD_ASK_TOOL_DESCRIPTION).toMatch(/never blocked/i);
  });

  it('keeps the cancellation promise the warehouse skill relies on', () => {
    expect(WIZARD_ASK_TOOL_DESCRIPTION).toMatch(
      /cancelled or timed-out response does NOT count/,
    );
  });

  it('explains what a subject is and what omitting it costs', () => {
    expect(WIZARD_ASK_SUBJECT_DESCRIPTION).toMatch(/Postgres/);
    expect(WIZARD_ASK_SUBJECT_DESCRIPTION).toMatch(/consecutive calls/i);
    expect(WIZARD_ASK_SUBJECT_DESCRIPTION).toMatch(/Omit it/);
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
