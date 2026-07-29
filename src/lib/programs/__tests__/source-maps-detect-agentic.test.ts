import {
  coerceReport,
  isNativePlatform,
  SOURCE_MAPS_TARGETS,
  type DetectedProject,
} from '@lib/programs/error-tracking-upload-source-maps/detect-agentic';
import { AUTOMATABLE_VARIANTS } from '@lib/programs/error-tracking-upload-source-maps/detect';

describe('SOURCE_MAPS_TARGETS precedence', () => {
  const ids = SOURCE_MAPS_TARGETS.map((t) => t.id);
  const rank = (id: string) => ids.indexOf(id);

  it('covers every automatable variant exactly once', () => {
    for (const variant of AUTOMATABLE_VARIANTS) {
      expect(ids.filter((id) => id === variant)).toHaveLength(1);
    }
  });

  it('ranks the cross-platform targets ahead of the native targets', () => {
    expect(SOURCE_MAPS_TARGETS).toContainEqual({
      id: 'react-native',
      name: 'React Native',
    });
    expect(SOURCE_MAPS_TARGETS).toContainEqual({
      id: 'android',
      name: 'Android',
    });
    expect(SOURCE_MAPS_TARGETS).toContainEqual({ id: 'ios', name: 'iOS' });
    // React Native and Flutter repos both carry Gradle and Xcode manifests
    // inside them, so they must win over the bare native targets.
    for (const crossPlatform of ['react-native', 'flutter']) {
      expect(rank(crossPlatform)).toBeLessThan(rank('android'));
      expect(rank(crossPlatform)).toBeLessThan(rank('ios'));
    }
    expect(rank('android')).toBeLessThan(rank('nextjs'));
    expect(rank('ios')).toBeLessThan(rank('nextjs'));
  });

  it('ranks bundlers ahead of the generic React variant', () => {
    // A React app built with Vite must resolve to `vite` (bundler-plugin
    // upload), not the generic `react` posthog-cli path — the regression that
    // shipped a posthog-cli setup into a Vite project.
    for (const bundler of ['vite', 'webpack', 'rollup']) {
      expect(rank(bundler)).toBeLessThan(rank('react'));
    }
  });

  it('ranks opinionated frameworks ahead of bundlers', () => {
    for (const fw of ['nextjs', 'nuxt', 'angular']) {
      expect(rank(fw)).toBeLessThan(rank('vite'));
    }
  });

  it('ranks the generic web fallback last among JS targets', () => {
    for (const other of ['react', 'node', 'vite']) {
      expect(rank(other)).toBeLessThan(rank('web'));
    }
  });
});

describe('isNativePlatform', () => {
  const project = (over: Partial<DetectedProject>): DetectedProject => ({
    path: '.',
    framework: 'Unknown',
    variant: null,
    hasPostHog: true,
    instrumentable: false,
    ...over,
  });

  it('flags native/mobile stacks the agent reports', () => {
    for (const framework of [
      'React Native',
      'react-native',
      'Expo',
      'Flutter',
      'iOS',
      'Android (Kotlin)',
      'Swift',
    ]) {
      expect(isNativePlatform(project({ framework }))).toBe(true);
    }
  });

  it('does not flag a supported web stack', () => {
    // A variant means it's automatable — never route it to the manual path.
    expect(
      isNativePlatform(project({ framework: 'Next.js', variant: 'nextjs' })),
    ).toBe(false);
    // Unsupported but non-native (e.g. a backend language) stays generic.
    expect(isNativePlatform(project({ framework: 'Rust' }))).toBe(false);
  });
});

describe('coerceReport', () => {
  it('marks a supported project with a PostHog SDK as instrumentable', () => {
    const report = coerceReport({
      repoType: 'single',
      projects: [
        {
          path: '.',
          framework: 'Next.js',
          targetId: 'nextjs',
          hasPostHog: true,
        },
      ],
    });

    expect(report.repoType).toBe('single');
    expect(report.projects).toHaveLength(1);
    const p = report.projects[0];
    expect(p.variant).toBe('nextjs');
    expect(p.instrumentable).toBe(true);
    expect(p.reason).toBeUndefined();
  });

  it('retains an iOS project with PostHog as instrumentable', () => {
    const report = coerceReport({
      repoType: 'single',
      projects: [
        {
          path: '.',
          framework: 'iOS',
          targetId: 'ios',
          hasPostHog: true,
        },
      ],
    });

    expect(report.projects[0]).toEqual({
      path: '.',
      framework: 'iOS',
      variant: 'ios',
      hasPostHog: true,
      instrumentable: true,
    });
  });

  it('blocks an iOS project that has no PostHog SDK yet', () => {
    const report = coerceReport({
      repoType: 'single',
      projects: [
        {
          path: '.',
          framework: 'iOS',
          targetId: 'ios',
          hasPostHog: false,
        },
      ],
    });

    expect(report.projects[0]).toEqual(
      expect.objectContaining({
        variant: 'ios',
        hasPostHog: false,
        instrumentable: false,
        reason: expect.stringMatching(/no posthog sdk/i),
      }),
    );
  });

  it.each(['React Native', 'Expo', 'Flutter'])(
    'blocks a native %s project misclassified as iOS',
    (framework) => {
      const report = coerceReport({
        repoType: 'single',
        projects: [
          {
            path: '.',
            framework,
            targetId: 'ios',
            hasPostHog: true,
          },
        ],
      });

      expect(report.projects[0]).toEqual(
        expect.objectContaining({
          variant: null,
          instrumentable: false,
          reason: expect.stringMatching(/isn't supported/i),
        }),
      );
    },
  );

  it('retains an Android project with PostHog as instrumentable', () => {
    const report = coerceReport({
      repoType: 'single',
      projects: [
        {
          path: '.',
          framework: 'Android',
          targetId: 'android',
          hasPostHog: true,
        },
      ],
    });

    expect(report.projects[0]).toEqual({
      path: '.',
      framework: 'Android',
      variant: 'android',
      hasPostHog: true,
      instrumentable: true,
    });
  });

  it('blocks an Android project that has no PostHog SDK yet', () => {
    const report = coerceReport({
      repoType: 'single',
      projects: [
        {
          path: '.',
          framework: 'Android',
          targetId: 'android',
          hasPostHog: false,
        },
      ],
    });

    expect(report.projects[0]).toEqual(
      expect.objectContaining({
        variant: 'android',
        hasPostHog: false,
        instrumentable: false,
        reason: expect.stringMatching(/no posthog sdk/i),
      }),
    );
  });

  it.each(['React Native', 'Expo', 'Flutter'])(
    'blocks a native %s project misclassified as Android',
    (framework) => {
      const report = coerceReport({
        repoType: 'single',
        projects: [
          {
            path: '.',
            framework,
            targetId: 'android',
            hasPostHog: true,
          },
        ],
      });

      expect(report.projects[0]).toEqual(
        expect.objectContaining({
          variant: null,
          instrumentable: false,
          reason: expect.stringMatching(/isn't supported/i),
        }),
      );
    },
  );

  it('retains a Flutter project with a platform target and PostHog as instrumentable', () => {
    const report = coerceReport(
      {
        repoType: 'single',
        projects: [
          {
            path: '.',
            framework: 'Flutter',
            targetId: 'flutter',
            hasPostHog: true,
          },
        ],
      },
      { hasBuildTarget: () => true },
    );

    expect(report.projects[0]).toEqual({
      path: '.',
      framework: 'Flutter',
      variant: 'flutter',
      hasPostHog: true,
      instrumentable: true,
    });
  });

  it('retains an Expo React Native project with PostHog as instrumentable', () => {
    const report = coerceReport(
      {
        repoType: 'single',
        projects: [
          {
            path: '.',
            framework: 'React Native',
            targetId: 'react-native',
            hasPostHog: true,
          },
        ],
      },
      { isExpoProject: () => true },
    );

    expect(report.projects[0]).toEqual({
      path: '.',
      framework: 'React Native',
      variant: 'react-native',
      hasPostHog: true,
      instrumentable: true,
    });
  });

  it('blocks a Flutter project with no platform targets at all', () => {
    // A pure Dart package or plugin has no web/, android/ or ios/ directory,
    // so it never produces an app build with symbols to upload.
    const report = coerceReport(
      {
        repoType: 'single',
        projects: [
          {
            path: '.',
            framework: 'Flutter',
            targetId: 'flutter',
            hasPostHog: true,
          },
        ],
      },
      { hasBuildTarget: () => false },
    );

    expect(report.projects[0]).toEqual(
      expect.objectContaining({
        variant: null,
        instrumentable: false,
        reason: expect.stringMatching(/no web, android or ios target/i),
      }),
    );
  });

  it('retains an Expo-labelled project resolved to react-native as instrumentable', () => {
    const report = coerceReport(
      {
        repoType: 'single',
        projects: [
          {
            path: '.',
            framework: 'Expo (React Native)',
            targetId: 'react-native',
            hasPostHog: true,
          },
        ],
      },
      { isExpoProject: () => true },
    );

    expect(report.projects[0]).toEqual(
      expect.objectContaining({
        variant: 'react-native',
        instrumentable: true,
      }),
    );
  });

  it('blocks a Flutter project with a platform target but no PostHog SDK yet', () => {
    const report = coerceReport(
      {
        repoType: 'single',
        projects: [
          {
            path: '.',
            framework: 'Flutter',
            targetId: 'flutter',
            hasPostHog: false,
          },
        ],
      },
      { hasBuildTarget: () => true },
    );

    expect(report.projects[0]).toEqual(
      expect.objectContaining({
        variant: 'flutter',
        hasPostHog: false,
        instrumentable: false,
        reason: expect.stringMatching(/no posthog sdk/i),
      }),
    );
  });

  it('blocks a bare React Native project (no expo package)', () => {
    const report = coerceReport({
      repoType: 'single',
      projects: [
        {
          path: '.',
          framework: 'React Native',
          targetId: 'react-native',
          hasPostHog: true,
        },
      ],
    });

    expect(report.projects[0]).toEqual(
      expect.objectContaining({
        variant: null,
        instrumentable: false,
        reason: expect.stringMatching(/bare react native/i),
      }),
    );
  });

  it('blocks an Expo React Native project that has no PostHog SDK yet', () => {
    const report = coerceReport(
      {
        repoType: 'single',
        projects: [
          {
            path: '.',
            framework: 'React Native',
            targetId: 'react-native',
            hasPostHog: false,
          },
        ],
      },
      { isExpoProject: () => true },
    );

    expect(report.projects[0]).toEqual(
      expect.objectContaining({
        variant: 'react-native',
        hasPostHog: false,
        instrumentable: false,
        reason: expect.stringMatching(/no posthog sdk/i),
      }),
    );
  });

  it('blocks a Flutter project misclassified as React Native', () => {
    const report = coerceReport({
      repoType: 'single',
      projects: [
        {
          path: '.',
          framework: 'Flutter',
          targetId: 'react-native',
          hasPostHog: true,
        },
      ],
    });

    expect(report.projects[0]).toEqual(
      expect.objectContaining({
        variant: null,
        instrumentable: false,
        reason: expect.stringMatching(/isn't supported/i),
      }),
    );
  });

  it('blocks a supported project that has no PostHog SDK yet', () => {
    const report = coerceReport({
      repoType: 'single',
      projects: [
        {
          path: '.',
          framework: 'Next.js',
          targetId: 'nextjs',
          hasPostHog: false,
        },
      ],
    });

    const p = report.projects[0];
    expect(p.instrumentable).toBe(false);
    expect(p.reason).toMatch(/no posthog sdk/i);
  });

  it('clamps unknown / unsupported variants to null and blocks them', () => {
    const report = coerceReport({
      repoType: 'monorepo',
      projects: [
        // no variant covers this stack
        {
          path: 'apps/desktop',
          framework: 'Qt',
          targetId: 'qt',
          hasPostHog: true,
        },
        // garbage value
        {
          path: 'apps/api',
          framework: 'Rust',
          targetId: 'rocket',
          hasPostHog: true,
        },
      ],
    });

    for (const p of report.projects) {
      expect(p.variant).toBeNull();
      expect(p.instrumentable).toBe(false);
      expect(p.reason).toMatch(/isn't supported/i);
    }
  });

  it('defaults missing / malformed fields safely', () => {
    const report = coerceReport({ projects: [{}] });

    expect(report.repoType).toBe('single');
    const p = report.projects[0];
    expect(p.path).toBe('.');
    expect(p.framework).toBe('Unknown');
    expect(p.variant).toBeNull();
    expect(p.hasPostHog).toBe(false);
    expect(p.instrumentable).toBe(false);
  });

  it('returns an empty report when projects is absent', () => {
    expect(coerceReport({}).projects).toEqual([]);
    expect(coerceReport(null).projects).toEqual([]);
  });
});
