import type { AuditCheck } from '@lib/programs/audit/types';
import {
  INITIAL_CULL_PROGRESS,
  type CullProgress,
} from '@lib/programs/cull-feature-flags/phase';
import { toLaneGroups } from '../cull/CullFlagList.js';

function check(
  id: string,
  area: string,
  status: AuditCheck['status'] = 'pending',
  details = 'rollout 100%',
): AuditCheck {
  return { id, area, status, details, label: id };
}

function progress(overrides: Partial<CullProgress>): CullProgress {
  return { ...INITIAL_CULL_PROGRESS, ...overrides };
}

describe('toLaneGroups', () => {
  it('groups rows in the configured lane order and sends unknown areas to nothing to cull', () => {
    const groups = toLaneGroups(
      [
        check('unknown', 'Future classifier area'),
        check('missing', 'Unreferenced'),
        check('off', 'Archived in PostHog'),
        check('decided', 'Rolled out'),
      ],
      INITIAL_CULL_PROGRESS,
      'verify',
    );

    expect(groups.map((group) => group.lane)).toEqual([
      'decided',
      'off-in-posthog',
      'not-in-code',
      'nothing-to-cull',
    ]);
    expect(groups[3].rows.map((row) => row.id)).toEqual(['unknown']);
  });

  it('folds healthy and many-call-site rows into one verify footer', () => {
    const groups = toLaneGroups(
      [
        check('healthy-one', 'Healthy', 'pass', 'rollout 25%'),
        check('healthy-two', 'Healthy', 'pass', 'multivariate'),
        check('wrapper', 'Many call sites', 'suggestion', 'rollout 50%'),
        check('candidate', 'Rolled out'),
      ],
      INITIAL_CULL_PROGRESS,
      'verify',
    );
    const nothingToCull = groups.find(
      (group) => group.lane === 'nothing-to-cull',
    );

    expect(nothingToCull).toMatchObject({
      rows: [],
      footer: '2 healthy, 1 suggestion, nothing to do',
    });
  });

  it('folds declined rows into their lane footer during cull', () => {
    const groups = toLaneGroups(
      [
        check(
          'declined-one',
          'Rolled out',
          'pass',
          'rollout 100%; declined by user',
        ),
        check(
          'declined-two',
          'Off for everyone',
          'pass',
          'rollout 0%; declined by user',
        ),
        check(
          'declined-three',
          'Disabled in PostHog',
          'pass',
          'inactive; declined by user',
        ),
      ],
      INITIAL_CULL_PROGRESS,
      'cull',
    );

    expect(groups).toEqual([
      expect.objectContaining({
        lane: 'decided',
        rows: [],
        footer: '2 left for you',
        complete: 2,
        total: 2,
      }),
      expect.objectContaining({
        lane: 'off-in-posthog',
        rows: [],
        footer: '1 left for you',
        complete: 1,
        total: 1,
      }),
    ]);
  });

  it('keeps kept rows visible in verify with the kept reason', () => {
    const [group] = toLaneGroups(
      [
        check(
          'kill-switch',
          'Off for everyone',
          'pass',
          'rollout 0%; kept: protects emergency rollback; reviewed',
        ),
      ],
      INITIAL_CULL_PROGRESS,
      'verify',
    );

    expect(group.rows[0]).toMatchObject({
      id: 'kill-switch',
      state: 'kept',
      text: 'kill-switch  protects emergency rollback',
    });
  });

  it('caps each lane at five rows and reports the hidden count', () => {
    const [group] = toLaneGroups(
      Array.from({ length: 7 }, (_, index) =>
        check(`flag-${index + 1}`, 'Rolled out'),
      ),
      INITIAL_CULL_PROGRESS,
      'verify',
    );

    expect(group.rows).toHaveLength(5);
    expect(group.hiddenCount).toBe(2);
    expect(group.total).toBe(7);
  });

  it.each([
    ['edit', 'active', [], 'editing'],
    ['disable', 'active', [], 'disabling'],
    ['verify', null, ['active'], 'edited'],
  ] as const)(
    'maps %s progress to the %s row state',
    (pass, activeKey, edited, expectedState) => {
      const [group] = toLaneGroups(
        [check('active', 'Rolled out', 'warning')],
        progress({ pass, activeKey, edited: [...edited] }),
        'cull',
      );

      expect(group.rows[0]).toMatchObject({
        state: expectedState,
        text: `active  ${expectedState}`,
      });
    },
  );

  it('does not mark any row active when the active key is unknown', () => {
    const states = toLaneGroups(
      [
        check('first', 'Rolled out', 'warning'),
        check('second', 'Off for everyone', 'warning'),
      ],
      progress({ pass: 'edit', activeKey: 'not-in-ledger' }),
      'cull',
    ).flatMap((lane) => lane.rows.map((row) => row.state));

    expect(states).toEqual(['proposed', 'proposed']);
  });
});
