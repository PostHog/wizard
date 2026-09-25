import {
  coerceAgenticReport,
  deriveReportJson,
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

describe('deriveReportJson', () => {
  const verdict = (path: string, targetId: string) =>
    `{"path":"${path}","framework":"Node.js","targetId":"${targetId}","hasPostHog":true}`;

  it('merges verdict lines and a one-line assembly, later entries winning', () => {
    // Every parseable line contributes: the pretty block parses on no line,
    // the compact assembly's projects merge like verdicts, later wins.
    const text = [
      verdict('backend-1', 'node'),
      verdict('backend-2', 'vite'),
      '```json',
      '{\n  "repoType": "monorepo",\n  "projects": []\n}',
      '```',
      '{"repoType":"monorepo","projects":[{"path":"backend-2","targetId":"rollup","hasPostHog":true}]}',
    ].join('\n');

    const parsed = deriveReportJson(text) as {
      repoType: string;
      projects: { path: string; targetId: string }[];
    };
    expect(parsed.repoType).toBe('monorepo');
    expect(parsed.projects.map((p) => [p.path, p.targetId])).toEqual([
      ['backend-1', 'node'],
      ['backend-2', 'rollup'],
    ]);
  });

  it('rebuilds the report from verdict lines when the assembly never arrived', () => {
    // The model sometimes narrates the assembly as prose; verdict lines are
    // the data. Shape echoes skip; repeated paths dedupe, last wins.
    const text = [
      'The shape is {"path":string}.',
      verdict('backend-1', 'vite'),
      verdict('backend-1', 'node'),
      verdict('backend-2', 'rollup'),
      '**Summary**: both projects classified.',
    ].join('\n');

    const parsed = deriveReportJson(text) as {
      repoType: string;
      projects: { path: string; targetId: string }[];
    };
    expect(parsed.repoType).toBe('monorepo');
    expect(parsed.projects.map((p) => [p.path, p.targetId])).toEqual([
      ['backend-1', 'node'],
      ['backend-2', 'rollup'],
    ]);
  });

  it('returns null when the text carries no usable objects', () => {
    expect(deriveReportJson('no report here')).toBeNull();
    expect(deriveReportJson('almost {"broken": json}')).toBeNull();
  });
});

describe('coerceAgenticReport matchingTargets', () => {
  const project = (
    extra: Record<string, unknown>,
    rerankIds?: readonly string[],
  ) =>
    coerceAgenticReport({ projects: [{ path: '.', ...extra }] }, TARGETS, {
      rerankIds,
    }).projects[0];

  it('re-ranks a valid pick only among rerankIds', () => {
    // Misordered honest enumeration: within the rerank set the priority
    // winner replaces the pick (TARGETS ranks node above vite)...
    expect(
      project({ matchingTargets: ['vite', 'node'], targetId: 'vite' }, [
        'node',
        'vite',
      ]).targetId,
    ).toBe('node');
    // ...but a winner outside the set never beats a valid pick — enumerations
    // get padded across exclusive stacks (a Flutter app listing react-native).
    expect(
      project({ matchingTargets: ['nextjs', 'vite'], targetId: 'vite' }, [
        'vite',
      ]).targetId,
    ).toBe('vite');
    expect(
      project({ matchingTargets: ['vite', 'node'], targetId: 'vite' }).targetId,
    ).toBe('vite');
  });

  it('falls back to the highest-priority enumerated id when the pick is unusable', () => {
    // TARGETS is the priority order; unknown ids are skipped.
    expect(
      project({ matchingTargets: ['rocket', 'vite', 'node'], targetId: null })
        .targetId,
    ).toBe('node');
    expect(
      project({ matchingTargets: ['vite'], targetId: 'rocket' }).targetId,
    ).toBe('vite');
    expect(project({ matchingTargets: ['rocket'] }).targetId).toBeNull();
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
    // Consumers that never opted in must never see the field, even when the agent emits it anyway.
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
