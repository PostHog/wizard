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
      'Cargo.toml',
      'go.mod',
      'build.gradle',
      'pubspec.yaml',
      // Apple: SPM, CocoaPods, XcodeGen spec, plain-Xcode pbxproj.
      'Package.swift',
      'Podfile',
      'project.yml',
      'project.pbxproj',
      // SDK-only ecosystems (no framework target); feed the "continue" path.
      'mix.exs',
      'pom.xml',
      '*.csproj',
      'gradle/libs.versions.toml',
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

  it('clamps escaping paths to "." — the path is LLM output', () => {
    // Absolute or ..-containing paths could steer integrate-run's targetDir
    // outside the repo (prompt-injection vector), so they must not survive.
    const clamp = (path: string) =>
      coerceAgenticReport({ projects: [{ path }] }, TARGETS).projects[0].path;
    expect(clamp('/etc')).toBe('.');
    expect(clamp('../../x')).toBe('.');
    expect(clamp('a/../../x')).toBe('.');
    expect(clamp('..\\x')).toBe('.');
  });

  it('keeps legitimate repo-relative paths', () => {
    const keep = (path: string) =>
      coerceAgenticReport({ projects: [{ path }] }, TARGETS).projects[0].path;
    expect(keep('apps/web')).toBe('apps/web');
    expect(keep('.')).toBe('.');
    expect(keep('ios')).toBe('ios');
  });
});
