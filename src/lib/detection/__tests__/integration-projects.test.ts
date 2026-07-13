import type { AgenticDetectionReport } from '@lib/detection/agentic';
import {
  chooseProject,
  resolveProjectDir,
  toIntegrationReport,
  type IntegrationDetectionReport,
  type IntegrationProject,
} from '@lib/detection/integration-projects';
import { Integration } from '@lib/constants';

const project = (
  overrides: Partial<IntegrationProject>,
): IntegrationProject => ({
  path: '.',
  framework: 'Unknown',
  integration: null,
  hasPostHog: false,
  instrumentable: false,
  continuable: false,
  ...overrides,
});

const report = (
  ...projects: IntegrationProject[]
): IntegrationDetectionReport => ({
  repoType: 'monorepo',
  projects,
});

describe('toIntegrationReport', () => {
  it('passes the recommended flag through, and leaves it absent when the scan did not ask', () => {
    const agentic: AgenticDetectionReport = {
      repoType: 'monorepo',
      projects: [
        {
          path: 'apps/api',
          framework: 'Express',
          targetId: 'javascript_node',
          hasPostHog: false,
        },
        {
          path: 'apps/web',
          framework: 'Next.js',
          targetId: 'nextjs',
          hasPostHog: false,
          recommended: true,
        },
      ],
    };
    const mapped = toIntegrationReport(agentic);
    expect(mapped.projects[0].recommended).toBeUndefined();
    expect(mapped.projects[1].recommended).toBe(true);
    // Classification is untouched by the flag.
    expect(mapped.projects[1].integration).toBe('nextjs');
    expect(mapped.projects[1].instrumentable).toBe(true);
  });
});

describe('chooseProject', () => {
  const api = project({
    path: 'apps/api',
    framework: 'Express',
    integration: Integration.javascriptNode,
    instrumentable: true,
  });
  const web = project({
    path: 'apps/web',
    framework: 'Next.js',
    integration: Integration.nextjs,
    instrumentable: true,
    recommended: true,
  });

  it('picks the recommended project when its framework is supported', () => {
    expect(chooseProject(report(api, web))?.path).toBe('apps/web');
  });

  it('picks the recommended project even when it already has PostHog', () => {
    // The main app wins over a PostHog-free secondary project: skipping it
    // would silently instrument an API service or docs site instead, and the
    // integration handles existing installs.
    const withPostHog = { ...web, hasPostHog: true, instrumentable: false };
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

  it('falls back to the first instrumentable project when nothing is recommended', () => {
    const instrumented = { ...api, hasPostHog: true, instrumentable: false };
    const fresh = project({
      path: 'apps/docs',
      framework: 'Astro',
      integration: Integration.astro,
      instrumentable: true,
    });
    expect(chooseProject(report(instrumented, fresh))?.path).toBe('apps/docs');
  });

  it('returns null when no project qualifies', () => {
    const unsupported = project({ path: 'crates/core', framework: 'Rust' });
    const instrumented = { ...api, hasPostHog: true, instrumentable: false };
    expect(chooseProject(report(unsupported, instrumented))).toBeNull();
    expect(chooseProject(report())).toBeNull();
  });
});

describe('resolveProjectDir', () => {
  it('scopes to the chosen sub-app inside the repo', () => {
    expect(resolveProjectDir('/repo', 'apps/web')).toBe('/repo/apps/web');
    expect(resolveProjectDir('/repo', '.')).toBe('/repo');
  });

  it('keeps the root for non-string paths (frameworkContext values are unknown)', () => {
    expect(resolveProjectDir('/repo', undefined)).toBe('/repo');
    expect(resolveProjectDir('/repo', 42)).toBe('/repo');
  });

  it('falls back to the repo root when the path escapes it', () => {
    // Defense-in-depth: the path is LLM output; coerceAgenticReport clamps
    // it, but the resolver must not trust the value either.
    expect(resolveProjectDir('/repo', '../../etc')).toBe('/repo');
    expect(resolveProjectDir('/repo', '/etc')).toBe('/repo');
    expect(resolveProjectDir('/repo', 'a/../..')).toBe('/repo');
  });
});
