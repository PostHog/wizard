import { describe, expect, it, vi } from 'vitest';
import { DiscoveredFeature } from '@shared/discovered-feature';
import { Integration } from '@shared/constants';
import { analytics } from '@utils/analytics';
import {
  applyFramework,
  frameworkTraitMismatch,
  getProjectTraits,
  traitsFromDetectors,
  traitsToSkillTags,
  withFramework,
} from '@services/project-traits/traits';
import type { ProjectTraits } from '@programs/program-contract';

vi.mock('@utils/analytics', () => ({ analytics: { setTag: vi.fn() } }));

describe('traitsFromDetectors', () => {
  it('reads the framework from detection', () => {
    expect(
      traitsFromDetectors({
        integration: Integration.nextjs,
        discoveredFeatures: [],
      }),
    ).toEqual({ framework: { value: 'nextjs', source: 'static' } });
  });

  it('leaves a trait no detector settles absent', () => {
    expect(
      traitsFromDetectors({ integration: null, discoveredFeatures: [] }),
    ).toEqual({});
  });

  it('says yes to LLM calls when an LLM SDK is a dependency, and never no', () => {
    expect(
      traitsFromDetectors({
        integration: null,
        discoveredFeatures: [DiscoveredFeature.LLM],
      }).callsLlmApi,
    ).toEqual({ value: 'yes', source: 'static' });
    expect(
      traitsFromDetectors({
        integration: null,
        discoveredFeatures: [DiscoveredFeature.Stripe],
      }).callsLlmApi,
    ).toBeUndefined();
  });
});

describe('getProjectTraits', () => {
  it('reads detection when no framework trait was written', () => {
    const session = {
      integration: Integration.django,
      discoveredFeatures: [DiscoveredFeature.LLM],
      projectTraits: {},
    };
    expect(getProjectTraits(session)).toEqual(traitsFromDetectors(session));
  });

  it('keeps the written framework trait and its source', () => {
    expect(
      getProjectTraits({
        integration: Integration.flask,
        discoveredFeatures: [],
        projectTraits: { framework: { value: 'flask', source: 'user' } },
      }).framework,
    ).toEqual({ value: 'flask', source: 'user' });
  });
});

describe('framework writes', () => {
  it('replaces the framework trait, or removes it for no framework', () => {
    const traits: ProjectTraits = {
      framework: { value: 'nextjs', source: 'static' },
      callsLlmApi: { value: 'yes', source: 'static' },
    };
    expect(withFramework(traits, Integration.nuxt, 'user')).toEqual({
      framework: { value: 'nuxt', source: 'user' },
      callsLlmApi: { value: 'yes', source: 'static' },
    });
    expect(withFramework(traits, null, 'static')).toEqual({
      callsLlmApi: { value: 'yes', source: 'static' },
    });
  });

  it('writes integration, the trait and both tags on a draft', () => {
    const draft = {
      integration: null as Integration | null,
      projectTraits: {} as ProjectTraits,
    };
    applyFramework(draft, Integration.rails);
    expect(draft).toEqual({
      integration: 'rails',
      projectTraits: { framework: { value: 'rails', source: 'static' } },
    });
    expect(analytics.setTag).toHaveBeenCalledWith('integration', 'rails');
    expect(analytics.setTag).toHaveBeenCalledWith('framework_source', 'static');
  });

  it('finds a write that went around the trait', () => {
    expect(
      frameworkTraitMismatch({ integration: null, projectTraits: {} }),
    ).toBeUndefined();
    expect(
      frameworkTraitMismatch({
        integration: Integration.nextjs,
        projectTraits: { framework: { value: 'nextjs', source: 'static' } },
      }),
    ).toBeUndefined();
    expect(
      frameworkTraitMismatch({
        integration: Integration.nextjs,
        projectTraits: {},
      }),
    ).toEqual({ trait: null, integration: 'nextjs' });
  });
});

describe('traitsToSkillTags', () => {
  it('maps the framework to its prefixed tag', () => {
    expect(
      traitsToSkillTags({
        framework: { value: 'javascript_web', source: 'static' },
      }),
    ).toEqual({ framework: ['framework:javascript_web'] });
  });

  it('gives a trait without a skill tag no tags', () => {
    expect(
      traitsToSkillTags({ callsLlmApi: { value: 'yes', source: 'static' } }),
    ).toEqual({});
  });
});
