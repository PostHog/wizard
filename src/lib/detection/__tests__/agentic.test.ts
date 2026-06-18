import { coerceAgenticReport, manifestGlob } from '@lib/detection/agentic';

const TARGETS = ['nextjs', 'node', 'vite'];

describe('manifestGlob', () => {
  it('is one brace-expansion glob covering JS, Python, Ruby, PHP and native manifests', () => {
    const glob = manifestGlob();
    expect(glob.startsWith('**/{')).toBe(true);
    expect(glob.endsWith('}')).toBe(true);
    for (const name of [
      'package.json',
      'pnpm-workspace.yaml',
      'requirements.txt',
      'Gemfile',
      'composer.json',
      'build.gradle',
      'pubspec.yaml',
    ]) {
      expect(glob).toContain(name);
    }
  });
});

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
