import type { AuditCheck } from '@lib/programs/audit/types';
import {
  INITIAL_CULL_PROGRESS,
  cullPhase,
  reduceCullProgress,
  type CullProgress,
} from '../slides/cull/phase';

function buildCheck(overrides: Partial<AuditCheck> = {}): AuditCheck {
  return {
    id: 'checkout-redesign',
    area: 'Rolled out',
    label: 'Keeps the on path',
    status: 'warning',
    file: 'src/checkout.ts',
    details: 'winning branch: true',
    ...overrides,
  };
}

function progress(overrides: Partial<CullProgress> = {}): CullProgress {
  return { ...INITIAL_CULL_PROGRESS, ...overrides };
}

const REPORT_PATH = './posthog-feature-flag-cull-report.md';

describe('reduceCullProgress', () => {
  it('reduces the complete cull status script as messages arrive', () => {
    const waiting = reduceCullProgress(
      INITIAL_CULL_PROGRESS,
      'Waiting for confirmation',
    );
    expect(waiting).toBe(INITIAL_CULL_PROGRESS);

    const firstFlag = reduceCullProgress(waiting, 'Culling checkout-redesign');
    expect(firstFlag).toEqual({
      pass: 'edit',
      activeKey: 'checkout-redesign',
      activeFile: null,
      edited: [],
    });

    const firstFile = reduceCullProgress(firstFlag, 'Editing src/checkout.ts');
    expect(firstFile).toEqual({
      ...firstFlag,
      activeFile: 'src/checkout.ts',
    });

    const secondFile = reduceCullProgress(
      firstFile,
      'Editing src/checkout.test.ts',
    );
    expect(secondFile).toEqual({
      ...firstFile,
      activeFile: 'src/checkout.test.ts',
    });

    const secondFlag = reduceCullProgress(secondFile, 'Culling search-v2');
    expect(secondFlag).toEqual({
      pass: 'edit',
      activeKey: 'search-v2',
      activeFile: null,
      edited: ['checkout-redesign'],
    });

    const verifying = reduceCullProgress(secondFlag, 'Type checking 2 files');
    expect(verifying).toEqual({
      pass: 'verify',
      activeKey: null,
      activeFile: null,
      edited: ['checkout-redesign', 'search-v2'],
    });

    const disabling = reduceCullProgress(
      verifying,
      'Disabling checkout-redesign in PostHog',
    );
    expect(disabling).toEqual({
      pass: 'disable',
      activeKey: 'checkout-redesign',
      activeFile: null,
      edited: ['checkout-redesign', 'search-v2'],
    });

    const completed = reduceCullProgress(
      disabling,
      'Culled 2 flags, 0 failed, 0 left for you',
    );
    expect(completed).toBe(disabling);
  });

  it('returns the same object for an unknown status line', () => {
    const currentProgress = progress({ pass: 'verify' });

    expect(reduceCullProgress(currentProgress, 'Writing report')).toBe(
      currentProgress,
    );
  });
});

describe('cullPhase', () => {
  it('stays in verify while any ledger row is pending', () => {
    expect(
      cullPhase(
        [buildCheck({ status: 'pending' })],
        INITIAL_CULL_PROGRESS,
        REPORT_PATH,
      ),
    ).toEqual({ phase: 'verify', copy: undefined });
  });

  it('waits for a pick when proposals are undecided and progress is idle', () => {
    const phase = cullPhase([buildCheck()], INITIAL_CULL_PROGRESS, REPORT_PATH);

    expect(phase.phase).toBe('pick');
    expect(phase.copy).toEqual({
      title: 'Waiting for your pick',
      paragraphs: expect.any(Array),
    });
  });

  it('enters cull when every approved proposal is still warning', () => {
    const checks = [
      buildCheck(),
      buildCheck({ id: 'search-v2', file: 'src/search.ts' }),
    ];
    const activeProgress = reduceCullProgress(
      INITIAL_CULL_PROGRESS,
      'Culling checkout-redesign',
    );
    const phase = cullPhase(checks, activeProgress, REPORT_PATH);

    expect(phase.phase).toBe('cull');
    expect(phase.copy).toMatchObject({
      title: 'Editing code',
      paragraphs: expect.any(Array),
    });
    expect(phase.copy?.paragraphs.join(' ')).toContain('checkout-redesign');
    const why = phase.copy?.paragraphs.find((paragraph) =>
      paragraph.startsWith('Why: '),
    );
    expect(why).toContain('Rolled out');
    expect(why).toContain('Keeps the code that runs today');
    expect(why).toContain('disabled in PostHog');
  });

  it.each([
    ['edit', 'Editing code'],
    ['verify', 'Checking the edits'],
    ['disable', 'Disabling flags in PostHog'],
  ] as const)('shows the %s pass card', (pass, expectedTitle) => {
    const phase = cullPhase([buildCheck()], progress({ pass }), REPORT_PATH);

    expect(phase).toMatchObject({
      phase: 'cull',
      copy: { title: expectedTitle, paragraphs: expect.any(Array) },
    });
  });

  it('enters cull while progress is idle after any row is decided', () => {
    const phase = cullPhase(
      [
        buildCheck(),
        buildCheck({
          id: 'old-search',
          status: 'pass',
          details: 'winning branch: false; declined by user',
        }),
      ],
      INITIAL_CULL_PROGRESS,
      REPORT_PATH,
    );

    expect(phase).toMatchObject({
      phase: 'cull',
      copy: { title: 'Culling', paragraphs: expect.any(Array) },
    });
  });

  it('uses the approved count when the active key is absent from the ledger', () => {
    const phase = cullPhase(
      [buildCheck(), buildCheck({ id: 'search-v2' })],
      progress({ pass: 'edit', activeKey: 'not-in-the-ledger' }),
      REPORT_PATH,
    );
    const paragraphs = phase.copy?.paragraphs.join(' ') ?? '';

    expect(phase.phase).toBe('cull');
    expect(paragraphs).toContain('Culling 2 flags');
    expect(paragraphs).not.toContain('not-in-the-ledger');
  });

  it('reports after proposals are resolved', () => {
    const phase = cullPhase(
      [buildCheck({ status: 'pass', details: 'winning branch: true; culled' })],
      progress({ pass: 'disable' }),
      REPORT_PATH,
    );

    expect(phase).toMatchObject({
      phase: 'report',
      copy: { paragraphs: expect.any(Array) },
    });
  });

  it('uses the report-only outcome after every proposal is declined', () => {
    const phase = cullPhase(
      [
        buildCheck({
          status: 'pass',
          details: 'winning branch: true; declined by user',
        }),
      ],
      INITIAL_CULL_PROGRESS,
      REPORT_PATH,
    );

    expect(phase).toEqual({
      phase: 'report',
      copy: {
        title: 'Report only. Nothing changed.',
        paragraphs: [
          expect.stringContaining('./posthog-feature-flag-cull-report.md'),
        ],
      },
    });
  });

  it('excludes report-only many-call-site warnings from proposals', () => {
    const phase = cullPhase(
      [buildCheck({ area: 'Many call sites' })],
      INITIAL_CULL_PROGRESS,
      REPORT_PATH,
    );

    expect(phase.phase).toBe('report');
    expect(phase.copy).toEqual({
      title: expect.any(String),
      paragraphs: expect.any(Array),
    });
  });
});
