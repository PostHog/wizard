import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { AUDIT_SEED_CHECKS, seedAuditLedger } from '@lib/programs/audit/seed';
import { AUDIT_CHECKS_FILE, type AuditCheck } from '@lib/programs/audit/types';
import { COL_AREA_WIDTH } from '@ui/tui/screens/audit/AuditChecksViewer/layout';

const ids = (checks: AuditCheck[]) => checks.map((c) => c.id);

describe('AUDIT_SEED_CHECKS', () => {
  it('has no duplicate ids', () => {
    // audit_add_checks rejects duplicates atomically, so a dupe in the seed
    // would make the skill's very first append fail for every project.
    expect(new Set(ids(AUDIT_SEED_CHECKS)).size).toBe(AUDIT_SEED_CHECKS.length);
  });

  it('keeps cross-runtime identity and session checks together', () => {
    const order = ids(AUDIT_SEED_CHECKS);
    const distinctId = order.indexOf('cross-runtime-distinct-id');
    const sessionId = order.indexOf('cross-runtime-session-id');

    expect(distinctId).toBeGreaterThan(-1);
    expect(sessionId).toBe(distinctId + 1);
    expect(AUDIT_SEED_CHECKS[sessionId]).toMatchObject({
      area: 'Identification',
      status: 'pending',
    });
  });

  it('sweeps PostHog for open findings before writing the report', () => {
    const order = ids(AUDIT_SEED_CHECKS);
    const sweep = order.indexOf('live-data-findings');

    expect(sweep).toBeGreaterThan(-1);
    // The sweep appends rows to the ledger, so it has to land before the
    // report step renders the ledger — otherwise its findings miss the report.
    expect(sweep).toBeLessThan(order.indexOf('write-report'));
    // Appended rows join this group instead of creating a new one after the
    // workflow rows, which is what keeps the sweep in place as it grows.
    expect(AUDIT_SEED_CHECKS[sweep].area).toBe('Live Data');
  });

  it('fits every area in the checks viewer column', () => {
    // Area is the one hard constraint: computeLayout pins it to a fixed
    // COL_AREA_WIDTH that never flexes, so a longer area name is truncated at
    // every terminal size. Labels get the flexed column and are allowed to run
    // past COL_LABEL_MIN — several seeded ones already do, and only clip on a
    // narrow terminal.
    for (const check of AUDIT_SEED_CHECKS) {
      expect(check.area.length).toBeLessThanOrEqual(COL_AREA_WIDTH);
    }
  });
});

describe('seedAuditLedger', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-seed-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes the seed to the ledger the skill reads', () => {
    seedAuditLedger(tmpDir);

    const written = JSON.parse(
      fs.readFileSync(path.join(tmpDir, AUDIT_CHECKS_FILE), 'utf8'),
    ) as AuditCheck[];

    expect(ids(written)).toEqual(ids(AUDIT_SEED_CHECKS));
  });
});
