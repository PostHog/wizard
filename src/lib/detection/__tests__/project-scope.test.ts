import type { AgenticProject } from '@lib/detection/agentic';
import { chooseIntegrationProject } from '@lib/detection/project-scope';

const project = (overrides: Partial<AgenticProject>): AgenticProject => ({
  path: '.',
  framework: 'Unknown',
  targetId: null,
  hasPostHog: false,
  ...overrides,
});

describe('chooseIntegrationProject', () => {
  const api = project({
    path: 'apps/api',
    framework: 'Express',
    targetId: 'javascript_node',
  });
  const web = project({
    path: 'apps/web',
    framework: 'Next.js',
    targetId: 'nextjs',
    recommended: true,
  });

  it('picks the recommended project when its framework is supported', () => {
    expect(chooseIntegrationProject([api, web])?.path).toBe('apps/web');
  });

  it('picks the recommended project even when it already has PostHog', () => {
    // The main app wins over a PostHog-free secondary project: skipping it
    // would silently instrument an API service or docs site instead, and the
    // integration handles existing installs.
    const withPostHog = { ...web, hasPostHog: true };
    expect(chooseIntegrationProject([api, withPostHog])?.path).toBe('apps/web');
  });

  it('skips an unsupported recommended project for the first supported fresh one', () => {
    const unsupported = project({
      path: 'ios',
      framework: 'Cordova',
      recommended: true,
    });
    expect(chooseIntegrationProject([unsupported, api])?.path).toBe('apps/api');
  });

  it('returns undefined when no project qualifies', () => {
    const unsupported = project({ path: 'crates/core', framework: 'Rust' });
    const instrumented = { ...api, hasPostHog: true };
    expect(chooseIntegrationProject([unsupported, instrumented])).toBe(
      undefined,
    );
    expect(chooseIntegrationProject([])).toBe(undefined);
  });
});
