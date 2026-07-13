import type {
  AgenticDetectionReport,
  AgenticProject,
} from '@lib/detection/agentic';
import {
  chooseProject,
  resolveProjectDir,
} from '@lib/detection/headless-scope';

const project = (overrides: Partial<AgenticProject>): AgenticProject => ({
  path: '.',
  framework: 'Unknown',
  targetId: null,
  hasPostHog: false,
  ...overrides,
});

const report = (...projects: AgenticProject[]): AgenticDetectionReport => ({
  repoType: 'monorepo',
  projects,
});

describe('chooseProject', () => {
  const api = project({
    path: 'apps/api',
    framework: 'Express',
    targetId: 'node',
  });
  const web = project({
    path: 'apps/web',
    framework: 'Next.js',
    targetId: 'nextjs',
    recommended: true,
  });

  it('picks the recommended project when its framework is supported', () => {
    expect(chooseProject(report(api, web))?.path).toBe('apps/web');
  });

  it('picks the recommended project even when it already has PostHog', () => {
    // The main app wins over a PostHog-free secondary project: skipping it
    // would silently instrument an API service or docs site instead, and the
    // integration handles existing installs.
    const withPostHog = { ...web, hasPostHog: true };
    expect(chooseProject(report(api, withPostHog))?.path).toBe('apps/web');
  });

  it('skips an unsupported recommended project for the first instrumentable one', () => {
    const unsupported = project({
      path: 'ios',
      framework: 'Cordova',
      recommended: true,
    });
    expect(chooseProject(report(unsupported, api))?.path).toBe('apps/api');
  });

  it('falls back to the first supported PostHog-free project when nothing is recommended', () => {
    const instrumented = { ...api, hasPostHog: true };
    const fresh = project({
      path: 'apps/docs',
      framework: 'Astro',
      targetId: 'astro',
    });
    expect(chooseProject(report(instrumented, fresh))?.path).toBe('apps/docs');
  });

  it('returns null when no project qualifies', () => {
    const unsupported = project({ path: 'crates/core', framework: 'Rust' });
    const instrumented = { ...api, hasPostHog: true };
    expect(chooseProject(report(unsupported, instrumented))).toBeNull();
    expect(chooseProject(report())).toBeNull();
  });
});

describe('resolveProjectDir', () => {
  it('scopes to the chosen sub-app inside the repo', () => {
    expect(resolveProjectDir('/repo', 'apps/web')).toBe('/repo/apps/web');
    expect(resolveProjectDir('/repo', '.')).toBe('/repo');
  });

  it('falls back to the repo root when the path escapes it', () => {
    // Defense-in-depth: the path is LLM output; coerceAgenticReport clamps
    // it, but the resolver must not trust the value either.
    expect(resolveProjectDir('/repo', '../../etc')).toBe('/repo');
    expect(resolveProjectDir('/repo', '/etc')).toBe('/repo');
    expect(resolveProjectDir('/repo', 'a/../..')).toBe('/repo');
  });
});
