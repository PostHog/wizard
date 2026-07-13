import {
  coerceAgenticReport,
  manifestGlob,
  resolveProjectDir,
} from '@lib/detection/agentic';

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

describe('resolveProjectDir', () => {
  it('scopes to the chosen sub-app inside the repo', () => {
    expect(resolveProjectDir('/repo', 'apps/web')).toBe('/repo/apps/web');
    expect(resolveProjectDir('/repo', '.')).toBe('/repo');
  });

  it('keeps the root for non-string values (session round-trips are unknown)', () => {
    expect(resolveProjectDir('/repo', undefined)).toBe('/repo');
    expect(resolveProjectDir('/repo', 42)).toBe('/repo');
  });

  it('falls back to the repo root when the path escapes it', () => {
    // Defense-in-depth on top of coercePath: the value is LLM output.
    expect(resolveProjectDir('/repo', '../../etc')).toBe('/repo');
    expect(resolveProjectDir('/repo', '/etc')).toBe('/repo');
    expect(resolveProjectDir('/repo', 'a/../..')).toBe('/repo');
  });
});

describe('coerceAgenticReport recommendation', () => {
  const projects = [
    {
      path: 'apps/api',
      framework: 'Express',
      targetId: 'node',
      hasPostHog: false,
    },
    {
      path: 'apps/web',
      framework: 'Next.js',
      targetId: 'nextjs',
      hasPostHog: false,
      recommended: true,
    },
  ];

  it('strips recommended entirely when the scan did not ask for it', () => {
    // Consumers that never opted in (self-driving, source-maps) must never
    // see the field, even when the agent emits it anyway.
    const report = coerceAgenticReport({ projects }, TARGETS);
    for (const p of report.projects) {
      expect('recommended' in p).toBe(false);
    }
  });

  it('keeps the recommended label when the scan asked for it', () => {
    const report = coerceAgenticReport({ projects }, TARGETS, {
      recommend: true,
    });
    expect(report.projects.map((p) => p.recommended)).toEqual([false, true]);
  });

  it('keeps at most one recommended project — the first', () => {
    const doubled = projects.map((p) => ({ ...p, recommended: true }));
    const report = coerceAgenticReport({ projects: doubled }, TARGETS, {
      recommend: true,
    });
    expect(report.projects.map((p) => p.recommended)).toEqual([true, false]);
  });

  it('coerces malformed recommended values to false', () => {
    const report = coerceAgenticReport(
      {
        projects: [
          { path: '.', recommended: 'yes' },
          { path: 'ios', recommended: 1 },
        ],
      },
      TARGETS,
      { recommend: true },
    );
    expect(report.projects.map((p) => p.recommended)).toEqual([false, false]);
  });

  it('keeps the label while an escaping path clamps to "."', () => {
    const report = coerceAgenticReport(
      { projects: [{ path: '/etc', recommended: true }] },
      TARGETS,
      { recommend: true },
    );
    expect(report.projects[0].path).toBe('.');
    expect(report.projects[0].recommended).toBe(true);
  });
});
