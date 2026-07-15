import { describe, it, expect } from 'vitest';
import { resolveSkillVariantId } from '../orchestrator-runner';
import { Integration } from '@lib/constants';

// A representative slice of the real install-step menu ids, including the
// families whose variant id differs from the framework enum.
const MENU = [
  'posthog-integration-install-django',
  'posthog-integration-install-laravel',
  'posthog-integration-install-nextjs-app-router',
  'posthog-integration-install-nextjs-pages-router',
  'posthog-integration-install-nuxt-3-6',
  'posthog-integration-install-vue-3',
  'posthog-integration-install-astro-hybrid',
  'posthog-integration-install-ruby-on-rails',
  'posthog-integration-install-react-react-router-6',
  'posthog-integration-install-react-react-router-7-framework',
  'posthog-integration-install-react-tanstack-router-code-based',
  'posthog-integration-install-swift',
  'posthog-integration-install-javascript_web',
];

const SKILL = 'posthog-integration-install';

describe('resolveSkillVariantId — framework/variant parity', () => {
  it('resolves the enums whose variant id differs from the enum value', () => {
    expect(resolveSkillVariantId(MENU, SKILL, 'rails')).toBe(
      'posthog-integration-install-ruby-on-rails',
    );
    expect(resolveSkillVariantId(MENU, SKILL, 'react-router')).toBe(
      'posthog-integration-install-react-react-router-6',
    );
    expect(resolveSkillVariantId(MENU, SKILL, 'tanstack-router')).toBe(
      'posthog-integration-install-react-tanstack-router-code-based',
    );
  });

  it('still resolves the frameworks that match by id or prefix', () => {
    expect(resolveSkillVariantId(MENU, SKILL, 'django')).toBe(
      'posthog-integration-install-django',
    );
    expect(resolveSkillVariantId(MENU, SKILL, 'nextjs')).toBe(
      'posthog-integration-install-nextjs-app-router',
    );
    expect(resolveSkillVariantId(MENU, SKILL, 'vue')).toBe(
      'posthog-integration-install-vue-3',
    );
  });

  it('every framework in a full menu resolves — no silent zero-diff', () => {
    // A menu with one install variant per Integration enum (aliased where the
    // id differs), so the whole enum must resolve.
    const alias: Record<string, string> = {
      'react-router': 'react-react-router-7-framework',
      'tanstack-router': 'react-tanstack-router-code-based',
      rails: 'ruby-on-rails',
      nextjs: 'nextjs-app-router',
      nuxt: 'nuxt-3-6',
      vue: 'vue-3',
      astro: 'astro-hybrid',
    };
    const enums = Object.values(Integration);
    const menu = enums.map(
      (e) => `${SKILL}-${(alias as Record<string, string>)[e] ?? e}`,
    );
    for (const e of enums) {
      expect(resolveSkillVariantId(menu, SKILL, e)).toBeDefined();
    }
  });
});
