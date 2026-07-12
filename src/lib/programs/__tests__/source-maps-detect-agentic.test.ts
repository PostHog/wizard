import {
  coerceReport,
  SOURCE_MAPS_TARGETS,
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

  it('ranks unsupported native guards ahead of the Android target', () => {
    expect(SOURCE_MAPS_TARGETS).toContainEqual({
      id: 'android',
      name: 'Android',
    });
    for (const nativeGuard of ['react-native', 'flutter', 'ios']) {
      expect(rank(nativeGuard)).toBeGreaterThanOrEqual(0);
      expect(rank(nativeGuard)).toBeLessThan(rank('android'));
    }
    expect(rank('android')).toBeLessThan(rank('nextjs'));
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

  it.each(['React Native', 'Expo', 'Flutter', 'iOS'])(
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
        // not in the automatable set
        {
          path: 'apps/mobile',
          framework: 'React Native',
          targetId: 'react-native',
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
