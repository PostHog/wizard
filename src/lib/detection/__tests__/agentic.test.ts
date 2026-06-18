import { coerceAgenticReport } from '@lib/detection/agentic';

const TARGETS = ['nextjs', 'node', 'vite'];

describe('coerceAgenticReport', () => {
  it('keeps a targetId that is in the valid set', () => {
    const report = coerceAgenticReport(
      {
        repoType: 'single',
        projects: [
          {
            path: '.',
            framework: 'Next.js',
            targetId: 'nextjs',
            hasPostHog: true,
          },
        ],
      },
      TARGETS,
    );

    expect(report.repoType).toBe('single');
    expect(report.projects[0].targetId).toBe('nextjs');
    expect(report.projects[0].hasPostHog).toBe(true);
  });

  it('clamps an unknown targetId to null', () => {
    const report = coerceAgenticReport(
      {
        repoType: 'monorepo',
        projects: [
          {
            path: 'apps/api',
            framework: 'Rust',
            targetId: 'rocket',
            hasPostHog: true,
          },
        ],
      },
      TARGETS,
    );

    expect(report.projects[0].targetId).toBeNull();
  });

  it('defaults malformed fields and an absent projects array', () => {
    expect(coerceAgenticReport({}, TARGETS).projects).toEqual([]);
    expect(coerceAgenticReport(null, TARGETS).projects).toEqual([]);

    const report = coerceAgenticReport({ projects: [{}] }, TARGETS);
    const p = report.projects[0];
    expect(p.path).toBe('.');
    expect(p.framework).toBe('Unknown');
    expect(p.targetId).toBeNull();
    expect(p.hasPostHog).toBe(false);
  });
});
