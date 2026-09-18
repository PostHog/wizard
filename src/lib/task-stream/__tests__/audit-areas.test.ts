import {
  rollUpAuditAreas,
  MAX_AUDIT_AREAS,
} from '@lib/task-stream/audit-areas';
import { StreamTaskStatus } from '@lib/task-stream/types';
import type { AuditCheck } from '@lib/programs/audit/types';

const check = (over: Partial<AuditCheck>): AuditCheck => ({
  id: 'id',
  area: 'Installation',
  label: 'label',
  status: 'pending',
  ...over,
});

describe('rollUpAuditAreas', () => {
  it('emits one row per area, in first-seen order, from its checks', () => {
    expect(
      rollUpAuditAreas(
        [
          check({ id: 'a', status: 'pass' }),
          check({ id: 'b', status: 'pending' }),
          check({ id: 'c', area: 'Live Data', status: 'pass' }),
          check({ id: 'd', area: 'Write report' }),
        ],
        2,
      ),
    ).toEqual([
      { id: '2', title: 'Installation', status: StreamTaskStatus.InProgress },
      { id: '3', title: 'Live Data', status: StreamTaskStatus.Completed },
      { id: '4', title: 'Write report', status: StreamTaskStatus.Pending },
    ]);
  });

  it('treats every finding as progress, never as a failed task', () => {
    for (const status of ['pass', 'error', 'warning', 'suggestion'] as const) {
      expect(rollUpAuditAreas([check({ status })])[0].status).toBe(
        StreamTaskStatus.Completed,
      );
    }
  });

  it('survives an agent-written ledger, and carries no check detail', () => {
    expect(rollUpAuditAreas(null)).toEqual([]);
    expect(rollUpAuditAreas({ checks: [] })).toEqual([]);
    expect(
      rollUpAuditAreas([
        check({ status: 'nonsense' as AuditCheck['status'] }),
      ])[0].status,
    ).toBe(StreamTaskStatus.Pending);

    const rows = rollUpAuditAreas([
      null,
      'not an object',
      check({ area: '  ' }),
      check({ area: `  ${'x'.repeat(200)}  ` }),
      check({ file: 'src/secret.ts:12', details: 'quotes user code' }),
      ...Array.from({ length: MAX_AUDIT_AREAS + 5 }, (_, i) =>
        check({ area: `Area ${i}` }),
      ),
    ]);
    expect(rows).toHaveLength(MAX_AUDIT_AREAS);
    expect(rows[0].title).toHaveLength(80);
    expect(JSON.stringify(rows)).not.toMatch(/secret|user code|label/);
  });
});
