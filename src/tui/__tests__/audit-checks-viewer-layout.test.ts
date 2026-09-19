import { describe, expect, it } from 'vitest';
import { AUDIT_SEED_CHECKS } from '@store/programs/audit/seed';
import { COL_AREA_WIDTH } from '../screens/audit/AuditChecksViewer/layout.js';

describe('AuditChecksViewer layout', () => {
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
