/** Regression coverage for the checklist squash bug (density selection). */
import {
  groupByArea,
  pickDensity,
} from '@ui/tui/screens/audit/PendingChecksList';
import { FEATURE_FLAGS_DOCTOR_SEED_CHECKS } from '@lib/programs/feature-flags-doctor/seed';

const groups = groupByArea(FEATURE_FLAGS_DOCTOR_SEED_CHECKS);
const activeIndex = 0; // fresh seed: everything pending, first group active

describe('groupByArea', () => {
  it('groups the doctor seed into its five areas in seed order', () => {
    expect(groups.map((g) => g.area)).toEqual([
      'Feature Flags',
      'Feature Flags — Optimize',
      'Feature Flags — Delivery',
      'Feature Flags — Observability',
      'Workflow',
    ]);
    expect(groups.map((g) => g.checks.length)).toEqual([6, 5, 5, 1, 2]);
  });
});

describe('pickDensity', () => {
  it('expands only the active group at the heights that used to squash', () => {
    // ghostty default ~28 rows: 19 rows + 5 headers + spacing never fit.
    for (const rows of [24, 28, 32]) {
      expect(pickDensity(groups, activeIndex, rows)).toBe('active');
    }
  });

  it('renders the full list when the terminal is tall enough', () => {
    expect(pickDensity(groups, activeIndex, 50)).toBe('full');
  });

  it('degrades to headers only in very short terminals', () => {
    expect(pickDensity(groups, activeIndex, 18)).toBe('headers');
  });

  it('accounts for the active group size, not just the group count', () => {
    // Delivery active (5 checks) needs one row less than correctness (6).
    const deliveryActive = groups.findIndex(
      (g) => g.area === 'Feature Flags — Delivery',
    );
    expect(pickDensity(groups, deliveryActive, 22)).toBe('active');
    expect(pickDensity(groups, activeIndex, 22)).toBe('headers');
  });

  it('falls back to headers when no group is active and nothing fits', () => {
    expect(pickDensity(groups, -1, 15)).toBe('headers');
  });
});
