import { AUDIT_SEED_CHECKS, AUDIT_CORE_CHECKS } from '../seed';
import { AUDIT_SPECIALISTS } from '../specialists';
import { parseAuditAreas, normalizeAuditArea, ALL_AUDIT_AREAS } from '../areas';

describe('audit basic specialist registry', () => {
  it('exposes identification + event-capture as the basic specialists', () => {
    expect(AUDIT_SPECIALISTS.map((s) => s.area)).toEqual([
      'Identification',
      'Event Capture',
    ]);
  });
});

describe('audit seed', () => {
  it('seeds 3 core + 4 identification + 3 event-capture (10 entries) unconditionally', () => {
    expect(AUDIT_SEED_CHECKS).toHaveLength(10);
    expect(AUDIT_SEED_CHECKS.slice(0, 3)).toEqual(AUDIT_CORE_CHECKS);
    expect(
      AUDIT_SEED_CHECKS.filter((c) => c.area === 'Identification'),
    ).toHaveLength(4);
    expect(
      AUDIT_SEED_CHECKS.filter((c) => c.area === 'Event Capture'),
    ).toHaveLength(3);
  });

  it('every seeded check starts as pending', () => {
    for (const check of AUDIT_SEED_CHECKS) {
      expect(check.status).toBe('pending');
    }
  });
});

describe('audit areas', () => {
  it('exposes the canonical 8-area enum', () => {
    expect(ALL_AUDIT_AREAS).toEqual([
      'Installation',
      'Identification',
      'Event Capture',
      'Web Analytics',
      'Feature Flags',
      'Experiments',
      'LLM Analytics',
      'Error Tracking',
    ]);
  });

  it('normalizes case-insensitively to canonical capitalization', () => {
    expect(normalizeAuditArea('web analytics')).toBe('Web Analytics');
    expect(normalizeAuditArea('LLM ANALYTICS')).toBe('LLM Analytics');
    expect(normalizeAuditArea('  feature flags  ')).toBe('Feature Flags');
    expect(normalizeAuditArea('not-a-real-area')).toBeNull();
  });

  it('parses --areas, dedupes, and surfaces unknown values for hinting', () => {
    const { areas, unknown } = parseAuditAreas(
      'Web Analytics, llm analytics, web analytics, bogus, feature flags',
    );
    expect(areas).toEqual(['Web Analytics', 'LLM Analytics', 'Feature Flags']);
    expect(unknown).toEqual(['bogus']);
  });

  it('returns empty when no input is provided', () => {
    const { areas, unknown } = parseAuditAreas(undefined);
    expect(areas).toEqual([]);
    expect(unknown).toEqual([]);
  });
});
