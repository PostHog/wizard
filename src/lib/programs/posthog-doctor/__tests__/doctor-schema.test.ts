import {
  HealthIssueListResponseSchema,
  HealthIssueSchema,
} from '@lib/programs/posthog-doctor/types';
import {
  getKindMeta,
  KIND_METADATA,
  UNKNOWN_KIND_META,
} from '@lib/programs/posthog-doctor/kind-metadata';

describe('posthog-doctor schema', () => {
  const canned = {
    results: [
      {
        id: 'issue-1',
        kind: 'ingestion_lag',
        severity: 'warning',
        status: 'active',
        dismissed: false,
        created_at: '2026-04-01T00:00:00Z',
        updated_at: '2026-04-02T00:00:00Z',
        resolved_at: null,
      },
      {
        id: 'issue-2',
        kind: 'sdk_outdated',
        severity: 'critical',
        status: 'active',
        dismissed: false,
        created_at: '2026-04-01T00:00:00Z',
        updated_at: '2026-04-01T00:00:00Z',
      },
    ],
    count: 2,
    next: null,
    previous: null,
  };

  it('parses a canned API response', () => {
    const parsed = HealthIssueListResponseSchema.parse(canned);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0].kind).toBe('ingestion_lag');
    expect(parsed.results[1].severity).toBe('critical');
  });

  it('rejects an unknown severity', () => {
    expect(() =>
      HealthIssueSchema.parse({
        ...canned.results[0],
        severity: 'catastrophic',
      }),
    ).toThrow();
  });

  it('rejects an unknown status', () => {
    expect(() =>
      HealthIssueSchema.parse({
        ...canned.results[0],
        status: 'pending',
      }),
    ).toThrow();
  });
});

describe('getKindMeta', () => {
  it('returns KIND_METADATA entry for known kinds', () => {
    const meta = getKindMeta('ingestion_lag');
    expect(meta).toBe(KIND_METADATA.ingestion_lag);
  });

  it('falls back to UNKNOWN_KIND_META with the raw kind as title', () => {
    const meta = getKindMeta('made-up-kind');
    expect(meta.description).toBe(UNKNOWN_KIND_META.description);
    expect(meta.docsUrl).toBe(UNKNOWN_KIND_META.docsUrl);
    expect(meta.title).toBe('made-up-kind');
  });
});
