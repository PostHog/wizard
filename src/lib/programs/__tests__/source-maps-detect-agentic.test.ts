import {
  coerceReport,
  SOURCE_MAPS_TARGETS,
} from '@lib/programs/error-tracking-upload-source-maps/detect-agentic';
import { AUTOMATABLE_VARIANTS } from '@lib/programs/error-tracking-upload-source-maps/detect';

describe('SOURCE_MAPS_TARGETS precedence', () => {
  const ids = SOURCE_MAPS_TARGETS.map((t) => t.id);
  const rank = (id: string) => ids.indexOf(id);

  it('covers every automatable variant exactly once', () => {
    expect([...ids].sort()).toEqual([...AUTOMATABLE_VARIANTS].sort());
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
