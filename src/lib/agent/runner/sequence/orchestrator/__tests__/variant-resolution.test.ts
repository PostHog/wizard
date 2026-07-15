import { describe, it, expect } from 'vitest';
import { resolveSkillVariantId } from '../orchestrator-runner';
import { Integration } from '@lib/constants';
import type { SkillEntry } from '@lib/wizard-tools';

// The integration group exactly as the context-mill build emits it into
// skill-menu.json (id + group + framework + default), so this suite pins the
// real cross-repo contract instead of a fixture that mirrors the resolver.
const INTEGRATION_ENTRIES = [
  { id: 'integration-nextjs-app-router', framework: 'nextjs', default: true },
  { id: 'integration-nextjs-pages-router', framework: 'nextjs' },
  {
    id: 'integration-react-react-router-6',
    framework: 'react-router',
    default: true,
  },
  {
    id: 'integration-react-react-router-7-framework',
    framework: 'react-router',
  },
  { id: 'integration-react-react-router-7-data', framework: 'react-router' },
  {
    id: 'integration-react-react-router-7-declarative',
    framework: 'react-router',
  },
  { id: 'integration-react-vite' },
  { id: 'integration-nuxt-3-6', framework: 'nuxt', default: true },
  { id: 'integration-nuxt-4', framework: 'nuxt' },
  { id: 'integration-vue-3', framework: 'vue' },
  { id: 'integration-django', framework: 'django' },
  { id: 'integration-flask', framework: 'flask' },
  { id: 'integration-fastapi', framework: 'fastapi' },
  {
    id: 'integration-react-tanstack-router-file-based',
    framework: 'tanstack-router',
  },
  {
    id: 'integration-react-tanstack-router-code-based',
    framework: 'tanstack-router',
    default: true,
  },
  { id: 'integration-tanstack-start', framework: 'tanstack-start' },
  { id: 'integration-laravel', framework: 'laravel' },
  { id: 'integration-php' },
  { id: 'integration-ruby-on-rails', framework: 'rails' },
  { id: 'integration-android', framework: 'android' },
  { id: 'integration-sveltekit', framework: 'sveltekit' },
  { id: 'integration-python', framework: 'python' },
  { id: 'integration-javascript_node', framework: 'javascript_node' },
  { id: 'integration-javascript_web', framework: 'javascript_web' },
  { id: 'integration-ruby', framework: 'ruby' },
  { id: 'integration-elixir' },
  { id: 'integration-go' },
  { id: 'integration-swift', framework: 'swift' },
  { id: 'integration-flutter' },
  { id: 'integration-react-native', framework: 'react-native', default: true },
  { id: 'integration-expo', framework: 'react-native' },
  { id: 'integration-astro-static', framework: 'astro' },
  { id: 'integration-astro-view-transitions', framework: 'astro' },
  { id: 'integration-astro-ssr', framework: 'astro' },
  { id: 'integration-astro-hybrid', framework: 'astro', default: true },
  { id: 'integration-angular', framework: 'angular' },
].map(
  (e): SkillEntry => ({
    ...e,
    group: 'integration',
    name: e.id,
    downloadUrl: `https://example.test/${e.id}.zip`,
  }),
);

// A single-variant skill collapses to the bare group id in the menu.
const MENU: SkillEntry[] = [
  ...INTEGRATION_ENTRIES,
  {
    id: 'posthog-integration-build',
    group: 'posthog-integration-build',
    name: 'build',
    downloadUrl: 'https://example.test/posthog-integration-build.zip',
  },
];

describe('resolveSkillVariantId — menu-declared framework resolution', () => {
  it('resolves a bare single-variant skill id to itself', () => {
    expect(
      resolveSkillVariantId(MENU, 'posthog-integration-build', 'django'),
    ).toBe('posthog-integration-build');
  });

  it('resolves a full menu id to itself, regardless of framework', () => {
    expect(
      resolveSkillVariantId(MENU, 'integration-nextjs-pages-router', 'nextjs'),
    ).toBe('integration-nextjs-pages-router');
  });

  it('resolves the frameworks whose variant id differs from the detection id', () => {
    expect(resolveSkillVariantId(MENU, 'integration', 'rails')).toBe(
      'integration-ruby-on-rails',
    );
    expect(resolveSkillVariantId(MENU, 'integration', 'react-router')).toBe(
      'integration-react-react-router-6',
    );
    expect(resolveSkillVariantId(MENU, 'integration', 'tanstack-router')).toBe(
      'integration-react-tanstack-router-code-based',
    );
  });

  it('picks the marked default when a family has several variants', () => {
    expect(resolveSkillVariantId(MENU, 'integration', 'nextjs')).toBe(
      'integration-nextjs-app-router',
    );
    expect(resolveSkillVariantId(MENU, 'integration', 'astro')).toBe(
      'integration-astro-hybrid',
    );
    expect(resolveSkillVariantId(MENU, 'integration', 'react-native')).toBe(
      'integration-react-native',
    );
  });

  it('resolves a single-entry family without needing a default marker', () => {
    expect(resolveSkillVariantId(MENU, 'integration', 'vue')).toBe(
      'integration-vue-3',
    );
    expect(resolveSkillVariantId(MENU, 'integration', 'django')).toBe(
      'integration-django',
    );
  });

  it('returns undefined without a framework or without a matching entry', () => {
    expect(
      resolveSkillVariantId(MENU, 'integration', undefined),
    ).toBeUndefined();
    expect(resolveSkillVariantId(MENU, 'integration', 'cobol')).toBeUndefined();
    // A variant with no framework field (react-vite) is only reachable by id.
    expect(resolveSkillVariantId(MENU, 'integration-react-vite', 'vue')).toBe(
      'integration-react-vite',
    );
  });

  it('every framework in the Integration enum resolves — no silent zero-diff', () => {
    for (const framework of Object.values(Integration)) {
      expect(
        resolveSkillVariantId(MENU, 'integration', framework),
        `framework "${framework}" resolved nothing`,
      ).toBeDefined();
    }
  });
});
